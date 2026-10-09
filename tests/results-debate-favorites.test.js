const fs = require('fs');
const path = require('path');

// Styles are split into styles/*.css behind a styles.css @import loader. Resolve
// the loader + its imported modules so CSS content assertions stay valid.
const readResolvedCss = () => {
  const dir = path.join(__dirname, '..');
  const loader = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
  const modules = [...loader.matchAll(/@import url\("(styles\/[^"]+\.css)"\)/g)]
    .map((m) => fs.readFileSync(path.join(dir, m[1]), 'utf8'));
  return [loader, ...modules].join('\n');
};

const delay = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

const blobToText = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error);
  reader.readAsText(blob);
});

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
        <button type="button" id="pipeline-add-btn">+</button><button type="button" id="pipeline-save-btn">Save</button>
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
        <div class="connector-group synthesis-capable" id="connectorToSynthesis" hidden aria-hidden="true">
          <svg class="connector-svg" id="svg-r-last-synthesis"></svg>
        </div>
        <div class="stage-column synthesis-capable" id="synthesisColumn" data-stage="synthesis" hidden aria-hidden="true">
          <div class="model-stack synthesis-stack" id="synthesis-stack" data-render="pipeline-synthesis-stack"></div>
        </div>
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
    </div>
  `;
}

function addDebateCard({ id, text, starred = false, model = 'GPT' }) {
  const sessionId = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId || '1';
  const card = document.createElement('div');
  card.className = 'debate-model-card';
  card.dataset.sessionId = sessionId;
  card.dataset.entryId = id;
  card.dataset.messageId = id;
  card.dataset.llmName = model;
  card.dataset.entryKind = 'response';
  card.dataset.kind = 'answer';
  card.dataset.starred = starred ? 'true' : 'false';
  card.innerHTML = `
    <div class="debate-model-card-header">
      <span class="debate-model-card-title-main">
        <span class="debate-model-card-name">${model}</span>
        <span class="debate-model-card-role"></span>
      </span>
      <span class="debate-model-card-meta">
        <span class="debate-model-card-time">12:00</span>
        <button type="button" class="ib debate-fav">★</button>
      </span>
    </div>
    <div class="debate-model-card-output">${text}</div>
  `;
  document.getElementById('debate-model-cards').appendChild(card);
  return card;
}

function addPendingApprovalCard({ id, text, model }) {
  const card = addDebateCard({ id, text, model });
  card.dataset.approved = 'false';
  card.dataset.approvalSelectable = 'true';
  const titleMain = card.querySelector('.debate-model-card-title-main');
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.className = 'debate-approval-check';
  checkbox.setAttribute('aria-label', 'Approve this answer');
  titleMain.appendChild(checkbox);
  return card;
}

async function selectTextInOutput(output, start, end) {
  const textNode = output.firstChild;
  const range = document.createRange();
  range.setStart(textNode, start);
  range.setEnd(textNode, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  output.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  await delay(20);
}

async function saveDisputeTopicDialog(topic = 'Saved dispute topic') {
  await delay(20);
  const textarea = document.getElementById('dispute-topic-textarea');
  if (!textarea) return false;
  textarea.value = topic;
  document.getElementById('dispute-topic-save-btn')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await delay(20);
  return true;
}

async function loadResultsScript(seededPipelineStore = null) {
  installChromeStorageMock();
  // A seeded store plays the part of what a previous page load left in chrome.storage.
  if (seededPipelineStore) chrome.storage.local.set({ llmComparatorPipelines: seededPipelineStore });
  installDomMocks();
  window.__RESULTS_TEST_DEBUG__ = true;
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'shared', 'status-contract.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'shared', 'answer-proof-normalization.js'), 'utf8'));
  const pipelineRuntime = fs.readFileSync(path.join(__dirname, '..', 'pipeline', 'pipeline-runtime.js'), 'utf8');
  window.eval(pipelineRuntime);
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'shared', 'transport-policy.js'), 'utf8'));
  const debateEngine = fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-engine.js'), 'utf8');
  window.eval(debateEngine);
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'shared', 'debate-schema.js'), 'utf8'));
  // DebateFSM is the explicit serial-debate state machine results.js init depends on.
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-runtime.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-protocols.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-run-store.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-protocol-transition-service.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-trace-schema.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-trace-store.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-trace-projections.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-execution-context.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-stage-types.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-policies.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-draft-plan.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-plan-revision.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-planner.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-participant-registry.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-stage-executor.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-orchestrator.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-application.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-state-map.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-artifact-pipeline.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-projections.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-prompt-catalog.js'), 'utf8'));
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', 'pipeline-presets.js'), 'utf8'));
  ['stage-markers', 'custom-engine', 'custom-run-record'].forEach((mod) => { window.eval(fs.readFileSync(path.join(__dirname, '..', 'disput', `${mod}.js`), 'utf8')); });
  ['boot-utils', 'dom-utils', 'attachments', 'pasted-text', 'tooltips', 'debate-ui', 'debate-transport', 'debate-controller', 'debate-renderer', 'debate-sessions-store', 'debate-export', 'debate-plan-view-model', 'debate-telemetry-view'].forEach((mod) => { window.eval(fs.readFileSync(path.join(__dirname, '..', 'results', `${mod}.js`), 'utf8')); });
  window.eval(fs.readFileSync(path.join(__dirname, '..', 'utils', 'selection-block-format.js'), 'utf8'));
  const script = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
  window.eval(script);
  document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
  await delay(20);
}

describe('Pipeline debate favorites view', () => {
  beforeAll(async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript();
  });

  beforeEach(async () => {
    const fullAnswers = document.getElementById('debate-full-answers-btn');
    if (fullAnswers.getAttribute('aria-pressed') === 'false') fullAnswers.click();
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (typeof callback === 'function') {
        callback({ status: 'ok', active: false });
      }
    });
    document.getElementById('debate-session-clear-btn').click();
    document.getElementById('modTa').value = '';
    document.getElementById('notification-message').textContent = '';
    const pipelineName = document.getElementById('currentPipelineName');
    if (pipelineName) {
      pipelineName.textContent = '';
      pipelineName.removeAttribute('title');
    }
    const senderSelect = document.getElementById('mod-sender-select');
    const receiverSelect = document.getElementById('mod-receiver-select');
    if (senderSelect) senderSelect.value = 'Moderator';
    if (receiverSelect) receiverSelect.value = '__none__';
    const newPagesCheckbox = document.getElementById('new-pages-checkbox');
    if (newPagesCheckbox) newPagesCheckbox.checked = true;
    window.setDebateSchemeValue?.('2');
    const policySelect = document.getElementById('debate-run-policy-select');
    if (policySelect) policySelect.value = 'manual';
    const roundLimitSelect = document.getElementById('debate-round-limit-select');
    if (roundLimitSelect) roundLimitSelect.value = '3';
    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.remove('active');
    });
    const deleteBtn = document.getElementById('debate-session-delete-btn');
    while (document.querySelectorAll('.debate-session-tab').length > 1) {
      deleteBtn.click();
      await delay(20);
    }
    const tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await delay(520);
    chrome.runtime.sendMessage.mockClear();
  });

  test('full answers defaults on, toggles every answer, persists and applies to incoming cards', async () => {
    const button = document.getElementById('debate-full-answers-btn');
    const first = addDebateCard({ id: 'full-mode-first', text: 'Line\n'.repeat(10), model: 'GPT' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(first);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(first.classList.contains('is-expanded')).toBe(true);
    button.click();
    expect(first.classList.contains('is-expanded')).toBe(false);
    const saved = await chrome.storage.local.get('llmCodexDebateFullAnswers.v1');
    expect(saved['llmCodexDebateFullAnswers.v1']).toBe(false);
    const second = addDebateCard({ id: 'full-mode-second', text: 'Next\n'.repeat(10), model: 'Gemini' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(second);
    expect(second.classList.contains('is-expanded')).toBe(false);
    button.click();
    expect(first.classList.contains('is-expanded')).toBe(true);
    expect(second.classList.contains('is-expanded')).toBe(true);
  });

  test('HTML feed export button downloads the document with shared model icons', async () => {
    const card = addDebateCard({ id: 'export-html', text: 'Feed export answer', model: 'GPT' });
    card.dataset.pipelineRoundId = 'r1';
    document.getElementById('modTa').value = 'Pipeline export prompt';
    const createUrl = URL.createObjectURL;
    const revokeUrl = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => 'blob:feed-export');
    URL.revokeObjectURL = jest.fn();
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      expect(this.download).toMatch(/\.html$/);
    });
    try {
      document.getElementById('debate-session-export-btn').click();
      expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
      const blob = URL.createObjectURL.mock.calls[0][0];
      expect(blob.type).toBe('text/html;charset=utf-8');
      const html = await blobToText(blob);
      expect(html).toContain('Feed export answer');
      const exported = new DOMParser().parseFromString(html, 'text/html');
      expect(exported.querySelector('.export-prompt').textContent).toContain('Pipeline export prompt');
      expect(exported.querySelector('.feed-navigation').nextElementSibling.className).toBe('prompt-section');
      expect(html).toContain('data:image/svg+xml;base64,');
      expect(html).toContain('data-view="round" data-value="r1"');
      expect(click).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:feed-export');
      // Production case: the submitted topic remains in the session tooltip,
      // while the composer has already been cleared by sending.
      const tab = document.querySelector('.debate-session-tab.active');
      const originalTitle = tab.title;
      const submittedPrompt = 'Submitted pipeline prompt\n'.repeat(600).trim();
      try {
        tab.title = submittedPrompt;
        document.getElementById('modTa').value = '';
        URL.createObjectURL.mockClear();
        document.getElementById('debate-session-export-btn').click();
        expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
        const submittedHtml = await blobToText(URL.createObjectURL.mock.calls[0][0]);
        const submittedDoc = new DOMParser().parseFromString(submittedHtml, 'text/html');
        expect(submittedDoc.body.firstElementChild.className).toBe('feed-navigation');
        expect(submittedDoc.querySelector('h1')).toBeNull();
        expect(submittedDoc.querySelector('.export-prompt').textContent).toBe(submittedPrompt);
        expect(submittedDoc.querySelector('.export-prompt').classList.contains('is-collapsed')).toBe(true);
      } finally {
        tab.title = originalTitle;
      }
    } finally {
      click.mockRestore();
      URL.createObjectURL = createUrl;
      URL.revokeObjectURL = revokeUrl;
    }
  });

  test('double-clicking the active session tab enables favorite-only without creating a session', async () => {
    const plain = addDebateCard({ id: 'msg-1', text: 'ordinary answer' });
    const starred = addDebateCard({ id: 'msg-2', text: 'saved answer', starred: true });
    const tab = document.querySelector('.debate-session-tab.active');

    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active').classList.contains('favorite-only')).toBe(true);
    expect(plain.style.display).toBe('none');
    expect(starred.style.display).toBe('');
  });

  test('single click on a favorite-only session returns the full timeline', async () => {
    const plain = addDebateCard({ id: 'msg-1', text: 'ordinary answer' });
    const starred = addDebateCard({ id: 'msg-2', text: 'saved answer', starred: true });
    let tab = document.querySelector('.debate-session-tab.active');

    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);
    expect(plain.style.display).toBe('none');

    tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await delay(220);

    expect(document.querySelector('.debate-session-tab.active').classList.contains('favorite-only')).toBe(false);
    expect(plain.style.display).toBe('');
    expect(starred.style.display).toBe('');
  });

  test('favoriting selected text creates a starred fragment-card linked to the source message', async () => {
    const source = addDebateCard({
      id: 'source-1',
      model: 'Claude',
      text: 'This answer contains an important fragment for later analysis.'
    });
    const output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 24, 42);
    document.querySelector('#debateSelTb [data-fav]').click();

    const fragment = document.querySelector('.fragment-card[data-kind="fragment"]');
    expect(fragment).not.toBeNull();
    expect(fragment.dataset.starred).toBe('true');
    expect(fragment.dataset.sessionId).toBe('1');
    expect(fragment.dataset.sourceMessageId).toBe('source-1');
    expect(fragment.dataset.sourceCardId).toBe(source.id);
    expect(fragment.textContent).toContain('important fragment');
    // applyDebateSessionFilter now coalesces its DOM sweep into one rAF, so the
    // display flip lands on the next frame instead of synchronously.
    await delay(20);
    expect(fragment.style.display).toBe('none');

    const tab = document.querySelector('.debate-session-tab.active');
    tab.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    await delay(20);
    expect(fragment.style.display).toBe('');
    expect(source.style.display).toBe('none');
  });

  test('one physical star press creates exactly one fragment card', async () => {
    const source = addDebateCard({
      id: 'source-pointer',
      model: 'GPT',
      text: 'One pointer press must create one favorite fragment.'
    });
    const output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 4, 19);
    const favorite = document.querySelector('#debateSelTb [data-fav]');

    favorite.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    favorite.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    const fragments = document.querySelectorAll('.fragment-card[data-kind="fragment"]');
    expect(fragments).toHaveLength(1);
    expect(fragments[0].textContent).toContain('pointer press');
  });

  test('one physical star press creates exactly one main-page favorite item', async () => {
    const output = document.getElementById('output-gemini');
    const favoriteState = window.__resultsExportDebug.favoriteState;
    const originalEntries = favoriteState.entries;
    favoriteState.entries = [];
    output.textContent = 'Main page favorite selection.';
    await selectTextInOutput(output, 10, 18);
    const favorite = document.querySelector('#responseSelTb [data-fav]');

    favorite.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    favorite.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(favoriteState.entries).toHaveLength(1);
    expect(favoriteState.entries[0].kind).toBe('fragment');
    expect(favoriteState.entries[0].text).toBe('favorite');
    favoriteState.entries = originalEntries;
    output.textContent = '';
  });

  test('main-page star keeps the toolbar open and a click outside dismisses it', async () => {
    const output = document.getElementById('output-gemini');
    const favoriteState = window.__resultsExportDebug.favoriteState;
    const originalEntries = favoriteState.entries;
    favoriteState.entries = [];
    output.textContent = 'Toolbar must stay open after starring.';
    await selectTextInOutput(output, 12, 16);
    const toolbar = document.getElementById('responseSelTb');
    const favorite = toolbar.querySelector('[data-fav]');

    favorite.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    favorite.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(favoriteState.entries).toHaveLength(1);
    expect(toolbar.classList.contains('vis')).toBe(true);
    expect(favorite.getAttribute('aria-pressed')).toBe('true');

    // A second press on the still-open toolbar must toggle the fragment back off.
    favorite.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, cancelable: true }));
    favorite.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(favoriteState.entries).toHaveLength(0);
    expect(toolbar.classList.contains('vis')).toBe(true);
    expect(favorite.getAttribute('aria-pressed')).toBe('false');

    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(toolbar.classList.contains('vis')).toBe(false);

    favoriteState.entries = originalEntries;
    output.textContent = '';
  });

  test('saved session TXT block indents the whole session under its name', () => {
    const { buildSessionExportBlock } = window.__resultsExportDebug;

    const block = buildSessionExportBlock('Session Name 1', {
      promptText: 'Compare the approaches',
      responseCards: [
        { outputId: 'output-gpt', llmName: 'GPT', text: 'First line\n\nThird line' },
        { outputId: 'output-claude', llmName: 'Claude', text: 'Claude answer' }
      ]
    });

    expect(block.split('\n')[0]).toBe('Session Name 1.');
    expect(block).toContain('\n    === Prompt ===\n    Compare the approaches');
    // No "=== LLM Responses ===" header: the session name opens the block.
    expect(block).not.toContain('LLM Responses');
    expect(block).toContain('\n    === GPT ===');
    expect(block).toContain('\n    === Claude ===\n    Claude answer');
    // Every line of a multi-line answer is shifted, and blank lines stay blank
    // so the file carries no trailing whitespace.
    expect(block).toContain('    First line\n\n    Third line');
    expect(block).not.toMatch(/^ +$/m);
    // Response metadata belongs to the live run, not to a stored session.
    expect(block).not.toMatch(/https?:\/\//);
  });

  test('saved session TXT block carries the session favourites and skips empty sessions', () => {
    const { buildSessionExportBlock } = window.__resultsExportDebug;

    const withFavorites = buildSessionExportBlock('Session Name 2', {
      responseCards: [{ outputId: 'output-gpt', llmName: 'GPT', text: 'Answer body' }],
      favorites: {
        entries: [{
          id: 'fav-1',
          kind: 'fragment',
          sourceName: 'GPT',
          modelKey: 'gpt',
          text: 'Starred fragment'
        }]
      }
    });
    expect(withFavorites).toContain('    === Favourite ===');
    expect(withFavorites).toContain('Starred fragment');
    // The Favourite panel of the open page must not leak into a session block.
    expect(withFavorites.indexOf('=== Favourite ===')).toBeLessThan(withFavorites.indexOf('=== GPT ==='));

    expect(buildSessionExportBlock('Empty', { responseCards: [] })).toBe('');
    expect(buildSessionExportBlock('Errors only', {
      responseCards: [{ outputId: 'output-gpt', llmName: 'GPT', text: 'Error: nothing arrived' }]
    })).toBe('');
  });

  test('collapsing the selection inside the same card dismisses the response toolbar', async () => {
    const output = document.getElementById('output-gemini');
    output.textContent = 'Collapse inside the very same output card.';
    await selectTextInOutput(output, 0, 8);
    const toolbar = document.getElementById('responseSelTb');
    expect(toolbar.classList.contains('vis')).toBe(true);

    window.getSelection().removeAllRanges();
    output.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await delay(20);

    expect(toolbar.classList.contains('vis')).toBe(false);
    output.textContent = '';
  });

  test('delete session removes the current session when multiple sessions exist', async () => {
    const addBtn = document.getElementById('debate-session-add-btn');
    addBtn.click();
    await delay(220);
    const activeBeforeDelete = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId;
    addDebateCard({ id: 'delete-me', text: 'session to remove' });
    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(2);

    document.getElementById('debate-session-delete-btn').click();
    await delay(30);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active')).not.toBeNull();
    expect(document.querySelector('.debate-session-tab.active')?.dataset?.sessionId).not.toBe(activeBeforeDelete);
    expect(document.querySelector('[data-session-id="' + activeBeforeDelete + '"]')).toBeNull();
  });

  test('delete session clears the only remaining session instead of removing it', async () => {
    const activeSessionId = document.querySelector('.debate-session-tab.active')?.dataset?.sessionId;
    addDebateCard({ id: 'only-session-card', text: 'this will be cleared' });
    expect(document.querySelectorAll('.debate-model-card')).toHaveLength(1);

    document.getElementById('debate-session-delete-btn').click();
    await delay(30);

    expect(document.querySelectorAll('.debate-session-tab')).toHaveLength(1);
    expect(document.querySelector('.debate-session-tab.active')?.dataset?.sessionId).toBe(activeSessionId);
    expect(document.querySelectorAll('.debate-model-card')).toHaveLength(0);
  });

  test('approving a lower pending card moves it above remaining pending cards', async () => {
    const qwen = addPendingApprovalCard({
      id: 'qwen-pending',
      model: 'Qwen',
      text: 'Qwen pending answer'
    });
    const leChat = addPendingApprovalCard({
      id: 'lechat-pending',
      model: 'Le Chat',
      text: 'Le Chat approved first'
    });

    expect(Array.from(document.querySelectorAll('.debate-model-card')).map((card) => card.dataset.llmName))
      .toEqual(['Qwen', 'Le Chat']);

    window.approveDebateCheckbox(leChat.querySelector('.debate-approval-check'));
    await delay(20);

    const order = Array.from(document.querySelectorAll('.debate-model-card')).map((card) => card.dataset.llmName);
    expect(order).toEqual(['Le Chat', 'Qwen']);
    expect(leChat.dataset.approved).toBe('true');
    expect(leChat.querySelector('.debate-approval-check')).toBeNull();
    expect(qwen.dataset.approved).not.toBe('true');
  });

  test('answer approval checkboxes exist only in manual mode', () => {
    const policy = document.getElementById('debate-run-policy-select');
    const debug = window.__pipelineLifecycleDebug;
    policy.value = 'auto';
    policy.dispatchEvent(new Event('change', { bubbles: true }));

    debug.updateLLMPanelOutput('GPT', 'Automatic answer', '', { status: 'SUCCESS' });
    let card = document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    expect(card.querySelector('.debate-approval-check')).toBeNull();

    policy.value = 'manual';
    policy.dispatchEvent(new Event('change', { bubbles: true }));
    card = document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    expect(card.querySelector('.debate-approval-check')).not.toBeNull();
  });

  test('unproven attribution is visibly marked and remains non-final in panel and feed card', () => {
    const debug = window.__pipelineLifecycleDebug;
    const panelFixture = document.createElement('section');
    panelFixture.id = 'panel-gpt';
    panelFixture.className = 'llm-panel';
    panelFixture.innerHTML = '<div class="output"></div>';
    document.body.appendChild(panelFixture);
    debug.updateLLMPanelOutput('GPT', 'Complete recovered answer', '', {
      status: 'RECEIVING',
      terminal: false,
      attributionState: 'unproven',
      attributionLabel: 'Attribution unverified'
    });

    const panel = document.getElementById('panel-gpt');
    const card = document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    expect(panel.classList.contains('has-unproven-attribution')).toBe(true);
    expect(panel.querySelector(':scope > .attribution-unproven-banner')?.textContent).toBe('Attribution unverified');
    expect(card.classList.contains('has-unproven-attribution')).toBe(true);
    expect(card.dataset.turnClosed).toBe('false');
    expect(card.querySelector('.attribution-unproven-banner')?.textContent).toBe('Attribution unverified');

    debug.updateLLMPanelOutput('GPT', 'Verified replacement answer', '', { status: 'SUCCESS' });
    expect(panel.classList.contains('has-unproven-attribution')).toBe(false);
    expect(panel.querySelector('.attribution-unproven-banner')).toBeNull();
  });

  test('selection toolbar formats the source card text in the normal timeline', async () => {
    const source = addDebateCard({
      id: 'source-format',
      model: 'GPT',
      text: 'Format this fragment in place.'
    });
    let output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 7, 11);
    const toolbar = document.getElementById('debateSelTb');
    toolbar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('#debateSelTb [data-color="#fde68a"]').click();

    let highlight = output.querySelector('span');
    expect(highlight).not.toBeNull();
    expect(highlight.textContent).toBe('this');
    expect(highlight.getAttribute('style')).toContain('background-color');
    expect(source.style.display).toBe('');
    expect(document.querySelector('.fragment-card')).toBeNull();

    const clearRange = document.createRange();
    clearRange.selectNodeContents(highlight);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(clearRange);
    output.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    await delay(20);
    document.querySelector('#debateSelTb [data-clear-highlight]').click();
    expect(highlight.style.backgroundColor).toBe('');

    output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 0, 6);
    toolbar.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    document.querySelector('#debateSelTb [data-cmd="bold"]').click();

    const bold = output.querySelector('strong');
    expect(bold).not.toBeNull();
    expect(bold.textContent).toBe('Format');
  });

  test('selection toolbar expands paragraph tools and stores list markup in a feed card', async () => {
    const source = addDebateCard({ id: 'source-list', model: 'GPT', text: 'First paragraph' });
    const output = source.querySelector('.debate-model-card-output');
    await selectTextInOutput(output, 0, 5);
    const toolbar = document.getElementById('debateSelTb');
    toolbar.querySelector('[data-more]').click();
    expect(toolbar.querySelector('.selection-toolbar-extra').hidden).toBe(false);
    toolbar.querySelector('[data-block="center"]').click();
    expect(output.style.textAlign).toBe('center');

    await selectTextInOutput(output, 0, 5);
    toolbar.querySelector('[data-more]').click();
    toolbar.querySelector('[data-block="list"]').click();
    expect(output.querySelector('ul > li')?.textContent).toBe('First paragraph');
  });

  test('main response toolbar expands paragraph tools and changes the selected paragraph', async () => {
    const output = document.getElementById('output-gemini');
    output.textContent = 'Main answer paragraph';
    await selectTextInOutput(output, 0, 4);
    const toolbar = document.getElementById('responseSelTb');
    toolbar.querySelector('[data-more]').click();
    expect(toolbar.querySelector('[data-more]').getAttribute('aria-expanded')).toBe('true');
    toolbar.querySelector('[data-block="right"]').click();
    expect(output.style.textAlign).toBe('right');
    await selectTextInOutput(output, 0, 4);
    toolbar.querySelector('[data-more]').click();
    toolbar.querySelector('[data-block="indent"]').click();
    expect(output.style.marginLeft).toBe('24px');
    output.textContent = '';
    output.removeAttribute('style');
  });

  test('export all responses includes Favourite content in the same HTML bundle', async () => {
    const responsePanel = document.createElement('div');
    responsePanel.className = 'llm-panel';
    responsePanel.id = 'panel-gpt';
    responsePanel.innerHTML = `
      <div class="llm-header">
        <span class="llm-title">GPT</span>
        <div class="header-right">
          <button type="button" class="panel-action-btn panel-fav-btn" data-target="gpt-output" aria-label="Add to favorites">★</button>
        </div>
      </div>
      <div class="output" id="gpt-output">Base model response.</div>
    `;
    document.body.appendChild(responsePanel);
    const originalBuildResponseCopyHtmlBlock = window.ResultsShared.buildResponseCopyHtmlBlock;
    window.ResultsShared.buildResponseCopyHtmlBlock = (name, metadataLine, bodyHtml) => `
      <section>
        <h2>${name}</h2>
        ${metadataLine ? `<p class="response-meta">${metadataLine}</p>` : ''}
        <div class="response-body">${bodyHtml}</div>
      </section>
    `;
    const originalFavoriteEntries = [...window.__resultsExportDebug.favoriteState.entries];
    const originalFavoriteCardMap = new Map(window.__resultsExportDebug.favoriteState.cardKeyToId);
    const originalFavoriteNextId = window.__resultsExportDebug.favoriteState.nextId;
    window.__resultsExportDebug.favoriteState.entries = [{
      id: 'fav-test-1',
      kind: 'card',
      sourceName: 'GPT',
      modelKey: 'gpt',
      sourceOutputId: 'gpt-output',
      text: 'Base model response.',
      html: '',
      timeLabel: '12:00'
    }];
    window.__resultsExportDebug.favoriteState.cardKeyToId = new Map([['card:gpt-output', 'fav-test-1']]);
    window.__resultsExportDebug.favoriteState.nextId = 2;
    const html = window.__resultsExportDebug.buildAllResponsesExportHtml();
    const text = window.__resultsExportDebug.buildAllResponsesExportText();
    const favoriteText = window.__resultsExportDebug.buildFavoriteExportText();
    expect(html).toContain('<nav class="model-navigation" aria-label="Model responses">');
    expect(html).toContain('class="model-nav-button" href="#response-1"');
    expect(html).toContain('.response-separator');
    expect(html).toContain('<h2>Favourite</h2>');
    expect(html).toContain('Base model response.');
    expect(text).toContain('=== Favourite ===');
    expect(text).toContain('--- GPT ---');
    expect(text).toContain('[12:00]');
    expect(text).not.toContain('LLM Responses');
    expect(text).toContain('Base model response.');
    expect(window.__resultsExportDebug.formatNamedExportStamp(new Date(2026, 6, 17, 18, 30))).toBe('jul26 18-30');
    document.getElementById('modTa').value = 'Разработка адаптера для новой версии провайдера';
    expect(window.__resultsExportDebug.formatExportPromptName()).toBe('Разработка адаптера для новой…');
    expect(window.__resultsExportDebug.buildResponseExportFilename(null, 'txt', new Date(2026, 7, 26, 10, 45)))
      .toBe('Разработка адаптера для новой… - LLMs aug26 10-45.txt');
    expect(window.__resultsExportDebug.buildResponseExportFilename('GPT', 'html', new Date(2026, 7, 26, 10, 45)))
      .toBe('Разработка адаптера для новой… - GPT aug26 10-45.html');
    expect(favoriteText).toBe('--- GPT ---\n[12:00]\nBase model response.');
    window.__resultsExportDebug.favoriteState.entries = originalFavoriteEntries;
    window.__resultsExportDebug.favoriteState.cardKeyToId = originalFavoriteCardMap;
    window.__resultsExportDebug.favoriteState.nextId = originalFavoriteNextId;
    window.ResultsShared.buildResponseCopyHtmlBlock = originalBuildResponseCopyHtmlBlock;
    responsePanel.remove();
  });

  test('selection toolbar actions have visible labels in the panel markup', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(html).toContain('aria-label="Yellow highlight"');
    expect(html.indexOf('data-clear-highlight="1"')).toBeLessThan(html.indexOf('aria-label="Yellow highlight"'));
    expect(html).toContain('aria-label="Remove highlight"');
    expect(html).toContain('<span class="stb-label">Yellow</span>');
    expect(html).toContain('<span class="stb-label">Bold</span>');
    expect(html).toContain('aria-label="Add selected fragment to favorites"');
    expect(html).toContain('<span class="stb-label">Favorite</span>');
  });

  test('selection toolbar is absolutely positioned near the selected fragment and has visible icons', async () => {
    const card = addDebateCard({ id: 'msg-toolbar', text: 'Toolbar anchor text', model: 'GPT' });
    const output = card.querySelector('.debate-model-card-output');

    await selectTextInOutput(output, 0, 7);

    const toolbar = document.getElementById('debateSelTb');
    expect(toolbar.classList.contains('vis')).toBe(true);
    expect(toolbar.style.top).toBeTruthy();
    expect(toolbar.style.left).toBeTruthy();

    const css = readResolvedCss();
    expect(css).toContain('.debate-sel-toolbar {\n    position: absolute;');
    expect(css).toContain('background: #ffffff;');
    expect(css).toContain('.debate-sel-toolbar .stb.col::before');
    expect(css).toContain('.debate-sel-toolbar .stb[data-clear-highlight]::before');
    expect(css).toContain('.debate-sel-toolbar .stb.col[data-color="#FFEB3B"] { --swatch-color: #FFEB3B; }');
    expect(css).toContain('.debate-sel-toolbar .stb[data-cmd="bold"]::before { content: "B"; }');
    expect(css).toContain('.debate-sel-toolbar .stb[data-fav]::before');
    expect(css).toContain('.debate-sel-toolbar .stb[data-fav][aria-pressed="true"]::before');
  });

  test('model cards use 14px text, keep empty one-line cards, and cap long responses at five lines', async () => {
    document.getElementById('debate-full-answers-btn').click();
    const css = readResolvedCss();
    expect(css).toContain('.debate-model-card,\n.debate-model-card :where(*) {\n    font-size: 14px !important;');
    expect(css).toContain('min-height: var(--debate-card-line-height);');
    expect(css).toContain('max-height: var(--debate-card-line-height);');
    expect(css).not.toContain('min-height: calc(var(--debate-card-line-height) * 6);');
    expect(css).toContain('max-height: calc(var(--debate-card-line-height) * 5);');
    expect(css).toContain('.debate-model-card.has-overflow {');
    expect(css).toContain('position: absolute;');

    const shortText = ['Short 1', 'Short 2', 'Short 3'].join('\n');
    const shortCard = addDebateCard({ id: 'msg-short-response', text: shortText, model: 'Gemini' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(shortCard);
    const shortShowMore = shortCard.querySelector('.debate-card-show-more');
    expect(shortShowMore).not.toBeNull();
    expect(shortShowMore.hidden).toBe(true);
    expect(shortCard.classList.contains('has-overflow')).toBe(false);
    expect(shortCard.classList.contains('is-expanded')).toBe(false);

    const longText = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join('\n');
    const card = addDebateCard({ id: 'msg-show-more', text: longText, model: 'GPT' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(card);

    const showMore = card.querySelector('.debate-card-show-more');
    expect(showMore).not.toBeNull();
    expect(showMore.hidden).toBe(false);
    expect(showMore.textContent).toBe('Show more');
    expect(card.classList.contains('is-expanded')).toBe(false);

    showMore.click();
    expect(card.classList.contains('is-expanded')).toBe(true);
    expect(showMore.hidden).toBe(false);
    expect(showMore.textContent).toBe('Minimise');
    showMore.click();
    expect(card.classList.contains('is-expanded')).toBe(false);
    expect(showMore.hidden).toBe(false);
    expect(showMore.textContent).toBe('Show more');

    const second = addDebateCard({ id: 'msg-dbl-expand', text: longText, model: 'Claude' });
    window.__pipelineLifecycleDebug.syncDebateCardOutputLayout(second);
    const secondName = second.querySelector('.debate-model-card-name');
    secondName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(second.classList.contains('is-expanded')).toBe(true);
    expect(second.classList.contains('is-wide-expanded')).toBe(true);
    expect(second.querySelector('.debate-card-show-more').textContent).toBe('Minimise');
    secondName.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(second.classList.contains('is-expanded')).toBe(false);
    expect(second.classList.contains('is-wide-expanded')).toBe(false);
    expect(second.querySelector('.debate-card-show-more').hidden).toBe(false);
    expect(second.querySelector('.debate-card-show-more').textContent).toBe('Show more');
  });

  test('wide card overlay uses the viewport and finalization removes printing marker', () => {
    const css = readResolvedCss();
    expect(css).toContain('.debate-model-card.is-wide-expanded {\n    position: fixed !important;');
    expect(css).toContain('inset: 16px;');
    expect(css).toContain('width: auto !important;');

    const debug = window.__pipelineLifecycleDebug;
    const card = addDebateCard({ id: 'printing-perplexity', model: 'Perplexity', text: 'Answer in progress' });
    card.dataset.live = 'true';
    card.dataset.turnClosed = 'false';
    const printing = document.createElement('div');
    printing.className = 'debate-model-card-printing';
    printing.textContent = '[Perplexity] printing';
    card.appendChild(printing);

    debug.finalizeDebatePrintingForModel('Perplexity');

    expect(card.querySelector('.debate-model-card-printing')).toBeNull();
    expect(card.dataset.live).toBe('false');
    expect(card.dataset.turnClosed).toBe('true');
  });

  test('debate cards render text through the same Markdown formatter as main response cards', () => {
    const card = addDebateCard({ id: 'msg-markdown-format', text: '', model: 'GPT' });
    const output = card.querySelector('.debate-model-card-output');
    const html = window.__pipelineLifecycleDebug.renderDebateResponseBody(
      output,
      '# Heading\n\n- first\n- second\n\n**bold** and `code`'
    );

    expect(html).toContain('<h1>Heading</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<code>code</code>');
  });

  test('main answer card reports the actually rendered payload identity', () => {
    const answer = 'Rendered proof answer';
    const proof = window.AnswerProofNormalization.evidence(answer, {
      dispatchId: 'Gemini:42:1', attemptId: 'render-attempt-1'
    });
    window.__pipelineLifecycleDebug.updateLLMPanelOutput('Gemini', answer, '', {
      dispatchId: 'Gemini:42:1',
      attemptId: 'render-attempt-1',
      expectedCardId: 'panel-gemini',
      ...proof
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ANSWER_CARD_RENDER_EVALUATED',
      llmName: 'Gemini',
      meta: expect.objectContaining({
        observedCardId: 'panel-gemini',
        outcome: 'matched',
        usableResult: true,
        payloadEvidenceId: proof.payloadEvidenceId,
        evaluationBoundaryId: expect.stringContaining('boundary:Gemini:42:1:render-attempt-1'),
        evaluationBoundaryType: 'delivery_deadline',
        resolutionState: 'delivered'
      })
    }));
  });

  test('double-clicking empty session-bar space opens and closes the entire debate feed widely', () => {
    const composer = document.querySelector('.prompt-container.prompt-sandwich.debate-composer');
    const hitArea = document.querySelector('.debate-session-bar-hit');

    hitArea.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(composer.classList.contains('is-debate-feed-wide-expanded')).toBe(true);
    expect(document.getElementById('debate-session-bar').getAttribute('aria-expanded')).toBe('true');

    hitArea.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(composer.classList.contains('is-debate-feed-wide-expanded')).toBe(false);
    expect(document.getElementById('debate-session-bar').getAttribute('aria-expanded')).toBe('false');

    const css = readResolvedCss();
    expect(css).toContain('.prompt-container.prompt-sandwich.debate-composer.is-debate-feed-wide-expanded {');
    expect(css).toContain('width: min(var(--center-max-width), calc(100vw - 32px));');
  });

  test('fullscreen button closes the inline feed on Escape and outside clicks', () => {
    const button = document.getElementById('debate-session-fullscreen-btn');
    const composer = document.querySelector('.debate-composer');
    button.click();
    expect(composer.classList.contains('is-debate-feed-wide-expanded')).toBe(true);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(composer.classList.contains('is-debate-feed-wide-expanded')).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(composer.classList.contains('is-debate-feed-wide-expanded')).toBe(false);
  });

  test('fullscreen feed reuses the answer popup bounds and delivers live visible cards', async () => {
    const previousWindows = chrome.windows;
    const previousTabs = chrome.tabs;
    const viewerWindow = { id: 91, tabs: [{ id: 92 }] };
    chrome.windows = {
      create: jest.fn(async () => viewerWindow),
      get: jest.fn(async () => viewerWindow),
      update: jest.fn(async () => viewerWindow),
      remove: jest.fn(async () => {})
    };
    chrome.tabs = { sendMessage: jest.fn((_tabId, _payload, callback) => callback()) };
    const button = document.getElementById('debate-session-fullscreen-btn');
    try {
      const first = addDebateCard({ id: 'viewer-gpt', text: '<p>First answer</p>' });
      const second = addDebateCard({ id: 'viewer-claude', model: 'Claude', text: '<p>Second answer</p>' });
      const hidden = addDebateCard({ id: 'viewer-hidden', text: 'Hidden session answer' });
      hidden.dataset.sessionId = 'other-session';
      first.querySelector('.debate-model-card-title-main').insertAdjacentHTML('beforeend', '<span class="debate-model-card-round">R2</span>');
      first.querySelector('.debate-model-card-name').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await delay(20);
      expect(chrome.windows.create).toHaveBeenCalledTimes(1);
      const { width, height, left, top } = chrome.windows.create.mock.calls[0][0];

      button.click();
      await delay(20);
      expect(chrome.windows.create).toHaveBeenCalledTimes(1);
      expect(chrome.windows.update).toHaveBeenLastCalledWith(91, { width, height, left, top, focused: true, state: 'normal' });
      expect(button.getAttribute('aria-expanded')).toBe('true');
      const payload = chrome.tabs.sendMessage.mock.calls.at(-1)[1];
      expect(payload.view).toBe('debate-feed');
      expect(payload.html).toContain('First answer');
      expect(payload.html).toContain('Second answer');
      expect(payload.html).toContain('R2');
      expect(payload.html).not.toContain('Hidden session answer');
      expect(payload.html).not.toContain('<button');
      expect(first.isConnected).toBe(true);
      expect(second.isConnected).toBe(true);

      chrome.tabs.sendMessage.mockClear();
      second.querySelector('.debate-model-card-output').insertAdjacentHTML('beforeend', '<p>Continuation</p>');
      await delay(20);
      expect(chrome.tabs.sendMessage.mock.calls.at(-1)[1].html).toContain('Continuation');
      expect(chrome.tabs.sendMessage.mock.calls.length).toBeLessThan(5);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(chrome.windows.remove).toHaveBeenCalledWith(91);
      expect(button.getAttribute('aria-expanded')).toBe('false');
    } finally {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      document.querySelector('.debate-model-card[data-entry-id="viewer-hidden"]')?.remove();
      chrome.windows = previousWindows;
      chrome.tabs = previousTabs;
    }
  });

  test('pipeline waiter matches answers only by transport request id', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const context = {
      pipelineRunId: 'run-1',
      pipelineRoundId: 'r1',
      pipelineBatchId: 'run-1:r1:g0'
    };
    let settled = false;
    const waitPromise = debug.pipelineWaiter
      .waitForModels(['GPT'], { timeoutMs: 200, context, requestIds: { GPT: 'treq-current' } });
    const observed = waitPromise.then((result) => {
      settled = true;
      return result;
    });

    expect(debug.pipelineWaiter.handlePartial({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      transportRequestId: 'treq-current',
      answer: 'first chunk',
      metadata: { ...context, status: 'GENERATING' }
    })).toBe(true);
    await delay(20);
    expect(settled).toBe(false);

    // A previous request of the same model, and an answer without identity.
    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      transportRequestId: 'treq-previous',
      answer: 'old final',
      metadata: { ...context, status: 'SUCCESS' }
    })).toBe(false);
    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'anonymous final',
      metadata: { ...context, status: 'SUCCESS' }
    })).toBe(false);
    await delay(20);
    expect(settled).toBe(false);

    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      transportRequestId: 'treq-current',
      answer: 'correct final',
      metadata: { ...context, status: 'SUCCESS' }
    })).toBe(true);

    await expect(observed).resolves.toMatchObject({
      responses: { GPT: 'correct final' },
      results: { GPT: { status: 'SUCCESS', completion: 'complete', transportRequestId: 'treq-current' } },
      missing: [],
      timedOut: false
    });
    expect(settled).toBe(true);
  });

  test('pipeline wait never ends before the tab generation limit', () => {
    const debug = window.__pipelineLifecycleDebug;
    const contract = window.TransportContract;
    const longFloor = contract.CONTENT_LIMITS_MS.long.hardMax
      + contract.CONTENT_LIMITS_MS.long.streamStart
      + contract.PANEL_WAIT_MARGIN_MS;

    expect(debug.resolvePipelineWaitTimeoutMs(['GPT'], 240000)).toBe(longFloor);
    expect(debug.resolvePipelineWaitTimeoutMs(['GPT'], 240000, 'long')).toBe(longFloor);
    expect(debug.resolvePipelineWaitTimeoutMs(['GPT'], 240000, 'inherit')).toBeGreaterThanOrEqual(
      contract.CONTENT_LIMITS_MS.standard.hardMax + contract.CONTENT_LIMITS_MS.standard.streamStart
    );
    expect(debug.resolvePipelineWaitTimeoutMs(['Qwen'], 5000000)).toBe(5000000);
  });

  test('visible Gemini answer cannot upgrade an unverified PARTIAL indicator to green', () => {
    const debug = window.__pipelineLifecycleDebug;
    const indicator = document.querySelector('.status-indicator[data-llm-name="Gemini"]');
    const answer = 'Gemini returned a complete visible answer. '.repeat(8);

    debug.updateModelStatusUI('Gemini', 'PARTIAL', {
      source: 'MODEL_FINAL',
      finalStatus: 'PARTIAL'
    });
    expect(indicator.classList.contains('partial')).toBe(true);

    debug.updateLLMPanelOutput('Gemini', answer, '', {});

    expect(document.getElementById('output-gemini').textContent).toContain('Gemini returned');
    expect(indicator.dataset.currentStatus).toBe('PARTIAL');
    expect(indicator.dataset.resultPhase).toBe('partial');
    expect(indicator.classList.contains('success')).toBe(false);
    expect(indicator.classList.contains('receiving')).toBe(false);
    expect(indicator.classList.contains('partial')).toBe(true);
  });

  test('a truncated rich-HTML projection cannot cut the committed answer text', () => {
    const debug = window.__pipelineLifecycleDebug;
    const fullAnswer = `${'Gemini complete paragraph with stable content. '.repeat(30)}FINAL-TAIL-KEPT`;
    const truncatedHtml = `<p>${fullAnswer.slice(0, -120)}</p>`;

    debug.updateLLMPanelOutput('Gemini', fullAnswer, truncatedHtml, {
      status: 'SUCCESS',
      requestId: 'gemini-complete-render'
    });

    expect(document.getElementById('output-gemini').textContent).toContain('FINAL-TAIL-KEPT');
    const card = document.querySelector('.debate-model-card[data-llm-name="Gemini"][data-request-id="gemini-complete-render"]');
    expect(card.querySelector('.debate-model-card-output').textContent).toContain('FINAL-TAIL-KEPT');
  });

  test('a settled debate card indicator is not repainted by a later force status for the same model', () => {
    const debug = window.__pipelineLifecycleDebug;
    const card = document.createElement('div');
    card.className = 'debate-model-card';
    card.dataset.llmName = 'GPT';
    card.innerHTML = '<span class="status-indicator" data-llm-name="GPT"></span><div class="debate-model-card-output">verified answer</div>';
    document.body.appendChild(card);
    const indicator = card.querySelector('.status-indicator');

    debug.updateModelStatusUI('GPT', 'SUCCESS', {
      source: 'FINAL_STATUS', finalStatus: 'SUCCESS', answer: 'verified answer',
      modelRunState: {
        executionState: 'terminal_success', terminalStatus: 'SUCCESS', uiStatus: 'SUCCESS',
        answerState: 'accepted', verificationState: 'verified'
      }
    });
    expect(indicator.classList.contains('success')).toBe(true);
    expect(indicator.dataset.statusFinal).toBe('1');

    // A later job for the same model force-resets status globally (LLM_JOB_CREATED).
    // The settled feed card from the earlier turn must NOT flip back.
    debug.updateModelStatusUI('GPT', 'INITIALIZING', { reset: true, force: true });
    expect(indicator.classList.contains('success')).toBe(true);
    expect(indicator.classList.contains('initializing')).toBe(false);
    expect(indicator.dataset.currentStatus).toBe('SUCCESS');

    card.remove();
  });

  test('post-terminal partial response preserves the accepted answer and adds a marked revision', () => {
    const debug = window.__pipelineLifecycleDebug;
    document.getElementById('panel-gpt')?.remove();
    const panel = document.createElement('section');
    panel.id = 'panel-gpt';
    panel.className = 'llm-panel';
    panel.innerHTML = '<div class="output"></div>';
    document.body.appendChild(panel);
    const output = panel.querySelector('.output');
    const original = 'Accepted terminal answer.';
    const revised = 'Accepted terminal answer with text appended after completion.';

    debug.updateLLMPanelOutput('GPT', original, '', {
      status: 'SUCCESS',
      requestId: 'post-terminal-lock'
    });
    const card = document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    expect(card.dataset.turnClosed).toBe('true');

    debug.updateLLMPanelOutput('GPT', revised, '', {
      source: 'late_partial_response',
      requestId: 'post-terminal-lock'
    });

    expect(card.querySelector('.debate-model-card-output').textContent.trim()).toBe(original);
    expect(output.textContent.trim()).toBe(original);
    const badge = card.querySelector('.post-terminal-badge');
    // One badge right of the time; each update is a tab with a short label.
    expect(badge.textContent).toBe('Δ 1');
    expect(badge.closest('.debate-model-card-header')).not.toBeNull();
    expect(card.querySelector('.debate-model-card-time').nextElementSibling).toBe(badge.parentElement);
    const revisionTab = card.querySelector('.post-terminal-tab');
    expect(revisionTab.textContent).toBe('1 · Late partial respons... · Δ +36');
    expect(revisionTab.title).toContain('Ответ обновлён после завершения');
    expect(revisionTab.title).toContain('late_partial_response');
    expect(card.querySelector('.post-terminal-answer-revision-body').dataset.fullLabel).toBe(revisionTab.title);
    expect(card.querySelector('.post-terminal-popover').hidden).toBe(true);
    badge.click();
    expect(card.querySelector('.post-terminal-popover').hidden).toBe(false);
    expect(badge.getAttribute('aria-expanded')).toBe('true');
    expect(card.querySelector('.post-terminal-answer-revision-body').textContent).toContain('text appended');

    // A second update joins the same badge as another tab; tabs switch the shown update.
    debug.updateLLMPanelOutput('GPT', `${revised} And a second late addition.`, '', {
      source: 'GLOBAL_STATE_ANSWER_RECOVERY',
      requestId: 'post-terminal-lock'
    });
    expect(card.querySelectorAll('.post-terminal-badge')).toHaveLength(1);
    expect(badge.textContent).toBe('Δ 2');
    const tabs = card.querySelectorAll('.post-terminal-tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[1].textContent).toContain('Recovery');
    const panels = () => Array.from(card.querySelectorAll('.post-terminal-answer-revision')).map((p) => p.hidden);
    expect(panels()).toEqual([true, false]);
    tabs[0].click();
    expect(panels()).toEqual([false, true]);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(card.querySelector('.post-terminal-popover').hidden).toBe(true);
    panel.remove();
  });

  test('re-emitting the shown answer with its delivery token is not a post-terminal revision', () => {
    const debug = window.__pipelineLifecycleDebug;
    // The real cleaner (token and trailing blanks), as loaded on the page.
    window.MessageDelivery = require('../shared/message-delivery.js');
    document.getElementById('panel-gpt')?.remove();
    const panel = document.createElement('section');
    panel.id = 'panel-gpt';
    panel.className = 'llm-panel';
    panel.innerHTML = '<div class="output"></div>';
    document.body.appendChild(panel);
    debug.updateLLMPanelOutput('GPT', 'Complete answer text.', '', { status: 'SUCCESS', requestId: 'recovery-echo' });
    const card = document.querySelector('.debate-model-card[data-llm-name="GPT"][data-request-id="recovery-echo"]')
      || document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    expect(card.dataset.turnClosed).toBe('true');

    // Global-state recovery hands over the raw text: token and trailing blanks included.
    debug.updateLLMPanelOutput('GPT', 'Complete answer text.   \n[[AO-abc123]]  ', '', {
      source: 'GLOBAL_STATE_ANSWER_RECOVERY', requestId: 'recovery-echo'
    });
    expect(card.querySelector('.post-terminal-answer-revision')).toBeNull();

    // Growth of the shown answer extends the same card: no second message, no badge.
    debug.updateLLMPanelOutput('GPT', 'Complete answer text. And more added later.', '', {
      source: 'GLOBAL_STATE_ANSWER_RECOVERY', requestId: 'recovery-echo'
    });
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')).toHaveLength(1);
    expect(card.querySelector('.debate-model-card-output').textContent).toContain('And more added later.');
    expect(card.querySelector('.post-terminal-badge')).toBeNull();

    // A text that changes what is shown (not a continuation) goes to the badge.
    debug.updateLLMPanelOutput('GPT', 'A completely different answer.', '', {
      source: 'GLOBAL_STATE_ANSWER_RECOVERY', requestId: 'recovery-echo'
    });
    expect(card.querySelector('.debate-model-card-output').textContent).toContain('And more added later.');
    expect(card.querySelectorAll('.post-terminal-badge')).toHaveLength(1);
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')).toHaveLength(1);
    delete window.MessageDelivery;
    panel.remove();
  });

  test('a repeat of the shown answer under another request id stays in the same card (markdown or not, shorter copies too)', () => {
    const debug = window.__pipelineLifecycleDebug;
    window.MessageDelivery = require('../shared/message-delivery.js');
    document.getElementById('panel-gpt')?.remove();
    const panel = document.createElement('section');
    panel.id = 'panel-gpt';
    panel.className = 'llm-panel';
    panel.innerHTML = '<div class="output"></div>';
    document.body.appendChild(panel);
    const raw = '**Dao** is the path.\n\n1. First point about the way.\n2. Second point about the flow.';
    debug.updateLLMPanelOutput('GPT', raw, '', { status: 'SUCCESS', requestId: 'round-a' });
    const cards = () => document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]');
    expect(cards()).toHaveLength(1);
    const card = cards()[0];
    expect(card.dataset.turnClosed).toBe('true');

    // Same answer re-emitted by a recovery/late partial under another request id: raw text
    // differs from the rendered card text, but nothing changed for the reader.
    debug.updateLLMPanelOutput('GPT', raw, '', { source: 'GLOBAL_STATE_ANSWER_RECOVERY', requestId: 'round-a-2' });
    debug.updateLLMPanelOutput('GPT', raw, '', { requestId: 'round-a-3' });
    // A shorter older copy of the shown answer is not an update either.
    debug.updateLLMPanelOutput('GPT', '**Dao** is the path.', '', { requestId: 'round-a-4' });
    expect(cards()).toHaveLength(1);
    expect(card.querySelector('.post-terminal-badge')).toBeNull();
    expect(card.dataset.live).toBe('false');

    // Growth under yet another request id extends the same card.
    debug.updateLLMPanelOutput('GPT', `${raw}\n3. Third point about harmony.`, '', { requestId: 'round-a-5' });
    expect(cards()).toHaveLength(1);
    expect(card.querySelector('.debate-model-card-output').textContent).toContain('Third point');
    expect(card.querySelector('.post-terminal-badge')).toBeNull();
    delete window.MessageDelivery;
    panel.remove();
  });

  test('an answer adopted while still printing keeps growing in its card (no new card)', () => {
    const debug = window.__pipelineLifecycleDebug;
    window.MessageDelivery = require('../shared/message-delivery.js');
    document.getElementById('panel-gpt')?.remove();
    const panel = document.createElement('section');
    panel.id = 'panel-gpt';
    panel.className = 'llm-panel';
    panel.innerHTML = '<div class="output"></div>';
    document.body.appendChild(panel);
    const cards = () => document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]');
    debug.updateLLMPanelOutput('GPT', 'First part of a long **answer', '', { status: 'GENERATING', requestId: 'adopted-1' });
    expect(cards()).toHaveLength(1);
    const card = cards()[0];
    expect(card.dataset.turnClosed).toBe('false');
    card.dataset.approved = 'true'; // Next/Pause adopted the shown text

    debug.updateLLMPanelOutput('GPT', 'First part of a long **answer** that keeps', '', { status: 'GENERATING', requestId: 'adopted-1' });
    expect(cards()).toHaveLength(1);
    expect(card.querySelector('.debate-model-card-output').textContent).toContain('that keeps');
    expect(card.querySelector('.post-terminal-badge')).toBeNull();

    debug.updateLLMPanelOutput('GPT', 'First part of a long **answer** that keeps growing to the end.', '', { status: 'SUCCESS', requestId: 'adopted-1' });
    expect(cards()).toHaveLength(1);
    expect(card.querySelector('.debate-model-card-output').textContent).toContain('to the end.');
    expect(card.dataset.turnClosed).toBe('true');
    expect(card.querySelector('.debate-model-card-printing')).toBeNull();
    expect(card.querySelector('.post-terminal-badge')).toBeNull();
    delete window.MessageDelivery;
    panel.remove();
  });

  test('Pause/next take the answer shown in the feed into the round wait, so the round can be closed with it', async () => {
    const debug = window.__pipelineLifecycleDebug;
    document.getElementById('panel-gpt')?.remove();
    const panel = document.createElement('section');
    panel.id = 'panel-gpt';
    panel.className = 'llm-panel';
    panel.innerHTML = '<div class="output"></div>';
    document.body.appendChild(panel);
    // The wait is open; the model's text reached the feed without reaching the wait.
    const wait = debug.pipelineWaiter.waitForModels(['GPT', 'Gemini'], { timeoutMs: 600000, requestIds: { GPT: 'treq-feed-gpt', Gemini: 'treq-feed-gem' } });
    wait.catch(() => {});
    expect(debug.pipelineWaiter.previewClose().closable).toBe(0);
    debug.updateLLMPanelOutput('GPT', 'Partial answer shown in the feed, still arriving', '', { status: 'RECEIVING', requestId: 'job-1' });
    expect(debug.harvestFeedAnswersForOpenRound()).toEqual(['GPT']);
    expect(debug.pipelineWaiter.previewClose()).toMatchObject({ closable: 1, partialModels: ['GPT'], skipModels: ['Gemini'] });
    debug.pipelineWaiter.closeAnsweredBatches('moderator_closed');
    const result = await wait;
    expect(result.responses.GPT).toContain('Partial answer shown in the feed');
    expect(result.results.GPT).toMatchObject({ completion: 'partial', moderatorAccepted: true });
    expect(result.skipped).toEqual(['Gemini']);
    // A closed card of an earlier round is never taken for the current one.
    document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]').forEach((card) => { card.dataset.turnClosed = 'true'; });
    const next = debug.pipelineWaiter.waitForModels(['GPT'], { timeoutMs: 600000, requestIds: { GPT: 'treq-feed-gpt-2' } });
    next.catch(() => {});
    expect(debug.harvestFeedAnswersForOpenRound()).toEqual([]);
    debug.pipelineWaiter.reset();
    panel.remove();
  });

  test('a model answer keeps at most one open card (no duplicate whole or partial)', () => {
    const debug = window.__pipelineLifecycleDebug;
    const container = document.getElementById('debate-model-cards');
    const openGptCards = () => Array.from(container.querySelectorAll('.debate-model-card[data-llm-name="GPT"]'))
      .filter((c) => c.dataset.approved !== 'true' && c.dataset.kind !== 'moderator' && c.dataset.kind !== 'fragment');

    // Streaming chunk then a fuller update for the same model reuse one card.
    debug.updateLLMPanelOutput('GPT', 'Dedup test chunk one', '', {});
    debug.updateLLMPanelOutput('GPT', 'Dedup test chunk one, now fuller and complete.', '', {});
    expect(openGptCards().length).toBe(1);
    expect(openGptCards()[0].querySelector('.debate-model-card-output').textContent).toContain('fuller and complete');

    // Inject an accidental duplicate (as a past bug could): the next update must
    // collapse it back to a single card rather than keep both.
    const dupe = openGptCards()[0].cloneNode(true);
    dupe.dataset.entryId = `dupe-${Date.now()}`;
    dupe.dataset.messageId = dupe.dataset.entryId;
    container.appendChild(dupe);
    expect(container.querySelectorAll('.debate-model-card[data-llm-name="GPT"]').length).toBeGreaterThanOrEqual(2);

    debug.updateLLMPanelOutput('GPT', 'Dedup test after duplicate injected.', '', {});
    expect(openGptCards().length).toBe(1);
  });

  test('final answers from later rounds append instead of replacing earlier model cards', () => {
    const debug = window.__pipelineLifecycleDebug;
    const cards = () => Array.from(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]'));

    debug.updateLLMPanelOutput('GPT', 'Round one concept', '', {
      status: 'SUCCESS',
      requestId: 'round-1-request'
    });
    debug.updateLLMPanelOutput('GPT', 'Round two improved concept', '', {
      status: 'SUCCESS',
      requestId: 'round-2-request'
    });

    expect(cards()).toHaveLength(2);
    expect(cards().map((card) => card.dataset.requestId)).toEqual(['round-1-request', 'round-2-request']);
    expect(cards().map((card) => card.querySelector('.debate-model-card-output').textContent))
      .toEqual(expect.arrayContaining(['Round one concept', 'Round two improved concept']));
    expect(cards().every((card) => card.dataset.turnClosed === 'true')).toBe(true);
  });

  test('runtime answer growth keeps one round card after the waiter closes and adds paragraphs', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const context = { pipelineRunId: 'round-card-run', pipelineRoundId: 'r1' };
    const wait = debug.pipelineWaiter.waitForModels(['GPT'], {
      context, requestIds: { GPT: 'round-card-request' }, timeoutMs: 600000
    });
    const receive = (answer, status, answerHtml = '') => {
      const message = {
        type: 'LLM_PARTIAL_RESPONSE', llmName: 'GPT', answer, answerHtml,
        transportRequestId: 'round-card-request', metadata: { status }
      };
      chrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => listener(message, {}, jest.fn()));
    };
    receive('First', 'GENERATING');
    const card = document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    receive('First paragraph.', 'GENERATING');
    receive('First paragraph.', 'SUCCESS');
    await wait;
    const output = card.querySelector('.debate-model-card-output');
    const firstParagraph = output.querySelector('p');
    expect(card.dataset.requestId).toBe('round-card-request');
    expect(card.dataset.pipelineRoundId).toBe('r1');
    expect(card.querySelector('.debate-model-card-name').nextElementSibling.textContent).toBe('R1');

    receive('First paragraph. Second paragraph.', 'SUCCESS');
    receive('First paragraph. Second paragraph. Third paragraph.', 'SUCCESS',
      '<p>First paragraph. Second paragraph. <strong>Third paragraph.</strong></p>');
    receive('First paragraph. Second paragraph. Third paragraph.', 'SUCCESS');
    receive('First paragraph.', 'SUCCESS'); // a stale, shorter copy

    expect(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')).toHaveLength(1);
    expect(output.querySelectorAll('p')).toHaveLength(3);
    expect(output.firstElementChild).toBe(firstParagraph);
    expect(Array.from(output.querySelectorAll('p'), (p) => p.textContent))
      .toEqual(['First paragraph.', 'Second paragraph.', 'Third paragraph.']);
    expect(output.querySelector('strong').textContent).toBe('Third paragraph.');
    expect(card.querySelector('.post-terminal-badge')).toBeNull();
    const session = debug.collectDebateArtifact().sessions.find((item) => item.sessionId === card.dataset.sessionId);
    expect(session.turns.filter((turn) => turn.author === 'GPT')).toHaveLength(1);
    expect(session.turns.find((turn) => turn.author === 'GPT').delivery).toMatchObject(context);
  });

  test('a manually recovered incomplete DeepSeek answer keeps its R3 badge', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const wait = debug.pipelineWaiter.waitForModels(['DeepSeek'], {
      context: { pipelineRunId: 'incomplete-run', pipelineRoundId: 'r3' },
      requestIds: { DeepSeek: 'incomplete-round-request' }, timeoutMs: 600000
    });
    const receive = (message) => {
      chrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => listener(message, {}, jest.fn()));
    };
    receive({
      type: 'MANUAL_PING_RESULT', llmName: 'DeepSeek', status: 'success', finalStatus: 'STREAM_TIMEOUT',
      answer: 'Recovered incomplete answer.', requestId: 'background-job-request',
      transportRequestId: 'incomplete-round-request'
    });
    const card = document.querySelector('.debate-model-card[data-llm-name="DeepSeek"]');
    const name = card.querySelector('.debate-model-card-name');
    expect(name.nextElementSibling.textContent).toBe('R3');
    expect(name.nextElementSibling.nextElementSibling.textContent).toBe('uncompleted');
    expect(card.dataset.requestId).toBe('incomplete-round-request');
    receive({
      type: 'LLM_PARTIAL_RESPONSE', llmName: 'DeepSeek', answer: 'Recovered incomplete answer.',
      transportRequestId: 'incomplete-round-request', metadata: { status: 'STREAM_TIMEOUT', terminal: true }
    });
    await wait;
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="DeepSeek"]')).toHaveLength(1);
    expect(card.querySelector('.debate-model-card-round').textContent).toBe('R3');
    expect(card.querySelectorAll('.answer-partial-mark')).toHaveLength(1);
  });

  test('an adopted answer receives its incomplete mark without losing its round or creating a card', () => {
    const debug = window.__pipelineLifecycleDebug;
    const meta = { requestId: 'adopted-incomplete', pipelineRunId: 'incomplete-adopt-run', pipelineRoundId: 'r3' };
    debug.updateLLMPanelOutput('DeepSeek', 'Text already shown.', '', { ...meta, status: 'GENERATING' });
    const card = document.querySelector('.debate-model-card[data-llm-name="DeepSeek"]');
    card.querySelector('.debate-approval-check').click();
    debug.updateLLMPanelOutput('DeepSeek', 'Text already shown.', '', { ...meta, status: 'PARTIAL' });
    const badge = card.querySelector('.debate-model-card-round');
    expect(badge.textContent).toBe('R3');
    expect(badge.nextElementSibling.textContent).toBe('uncompleted');
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="DeepSeek"]')).toHaveLength(1);
    debug.updateLLMPanelOutput('DeepSeek', 'Text already shown.', '', { ...meta, status: 'SUCCESS' });
    expect(card.querySelector('.answer-partial-mark')).toBeNull();
    expect(card.querySelector('.debate-model-card-round')).toBe(badge);
  });

  test('feed retains each round’s response time and source URL independently', () => {
    const debug = window.__pipelineLifecycleDebug;
    const first = new Date(2026, 9, 5, 10, 33).getTime();
    const second = new Date(2026, 9, 5, 11, 44).getTime();
    debug.updateLLMPanelOutput('GPT', 'First provenance answer', '', {
      status: 'SUCCESS', requestId: 'provenance-r1', pipelineRunId: 'provenance', pipelineRoundId: 'r1',
      completedAt: first, url: 'https://chatgpt.com/c/first-round'
    });
    debug.updateLLMPanelOutput('GPT', 'Second provenance answer', '', {
      status: 'SUCCESS', requestId: 'provenance-r2', pipelineRunId: 'provenance', pipelineRoundId: 'r2',
      completedAt: second, url: 'https://chatgpt.com/c/second-round'
    });
    const cards = [...document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')];
    const firstCard = cards.find((card) => card.dataset.pipelineRoundId === 'r1');
    const secondCard = cards.find((card) => card.dataset.pipelineRoundId === 'r2');
    expect(firstCard.dataset.sourceUrl).toBe('https://chatgpt.com/c/first-round');
    expect(firstCard.dataset.responseTimestamp).toBe(String(first));
    expect(secondCard.dataset.sourceUrl).toBe('https://chatgpt.com/c/second-round');
    expect(window.DebateExport.cardParts(firstCard).metadata).toBe('2026-10-05 10-33  https://chatgpt.com/c/first-round');
  });

  test('recovered Gemini R3 and its repeated final keep one badged card without an in-memory waiter', () => {
    const debug = window.__pipelineLifecycleDebug;
    const receive = (message) => {
      chrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => listener(message, {}, jest.fn()));
    };
    debug.updateLLMPanelOutput('DeepSeek', 'Incomplete preceding answer.', '', {
      status: 'PARTIAL', requestId: 'report-deepseek', pipelineRunId: 'report-run', pipelineRoundId: 'r2'
    });
    const identity = {
      transportRequestId: 'report-gemini-r3', pipelineRunId: 'report-run', pipelineRoundId: 'r3'
    };
    const answer = 'Critical stress testing and analysis of stability boundaries.';
    expect(debug.pipelineWaiter.responseContexts.has(identity.transportRequestId)).toBe(false);
    document.getElementById('output-gemini').replaceChildren();
    receive({
      type: 'GLOBAL_STATE_BROADCAST',
      state: { llms: { Gemini: { ...identity, answer, status: 'SUCCESS', finalStatus: 'SUCCESS', finalStatusRecorded: true } } }
    });
    const card = document.querySelector('.debate-model-card[data-llm-name="Gemini"]');
    expect(card.querySelector('.debate-model-card-round')?.textContent).toBe('R3');
    expect(card.dataset.turnClosed).toBe('true');
    receive({
      type: 'MANUAL_PING_RESULT', llmName: 'Gemini', answer, status: 'success', finalStatus: 'SUCCESS',
      requestId: 'background-gemini-job', ...identity
    });
    receive({ type: 'LLM_FINAL_RESPONSE', llmName: 'Gemini', answer, status: 'SUCCESS', ...identity });
    receive({
      type: 'LLM_FINAL_RESPONSE', llmName: 'Gemini', answer: `${answer} Another paragraph.`, status: 'SUCCESS', ...identity
    });
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="Gemini"]')).toHaveLength(1);
    expect(card.querySelectorAll('.debate-model-card-round')).toHaveLength(1);
    expect(Array.from(card.querySelectorAll('.debate-model-card-output p'), (p) => p.textContent))
      .toEqual([answer, 'Another paragraph.']);
    const deepSeek = document.querySelector('.debate-model-card[data-llm-name="DeepSeek"]');
    expect(deepSeek.querySelector('.debate-model-card-round').textContent).toBe('R2');
    expect(deepSeek.querySelector('.answer-partial-mark').textContent).toBe('uncompleted');
    const turns = debug.collectDebateArtifact().sessions.flatMap((session) => session.turns);
    expect(turns.filter((turn) => turn.author === 'Gemini')).toHaveLength(1);
    expect(turns.find((turn) => turn.author === 'Gemini').delivery).toMatchObject({
      pipelineRunId: 'report-run', pipelineRoundId: 'r3', requestId: identity.transportRequestId
    });
  });

  test('round identity arriving after an approved recovery adds the badge to that same request card', () => {
    const debug = window.__pipelineLifecycleDebug;
    debug.updateLLMPanelOutput('Gemini', 'Recovered answer.', '', { status: 'SUCCESS', requestId: 'late-round-identity' });
    const card = document.querySelector('.debate-model-card[data-llm-name="Gemini"]');
    card.querySelector('.debate-approval-check').click();
    const firstParagraph = card.querySelector('.debate-model-card-output p');
    debug.updateLLMPanelOutput('Gemini', 'Recovered answer. Continuation.', '', {
      status: 'SUCCESS', transportRequestId: 'late-round-identity', pipelineRunId: 'late-identity-run', pipelineRoundId: 'r3'
    });
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="Gemini"]')).toHaveLength(1);
    expect(card.isConnected).toBe(true);
    expect(card.dataset.approved).toBe('true');
    expect(card.querySelector('.debate-model-card-round').textContent).toBe('R3');
    expect(card.querySelector('.debate-model-card-output p')).toBe(firstParagraph);
    expect(card.querySelectorAll('.debate-model-card-output p')).toHaveLength(2);
    const turn = debug.collectDebateArtifact().sessions.flatMap((session) => session.turns).find((item) => item.author === 'Gemini');
    expect(turn.delivery.pipelineRoundId).toBe('r3');
  });

  test('Get it replays a pending answer into its original round after a later round has completed', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const autoCheckbox = document.getElementById('auto-checkbox');
    autoCheckbox.checked = false;
    autoCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
    const message = {
      type: 'LLM_PARTIAL_RESPONSE', llmName: 'Gemini', answer: 'Earlier round still printing.',
      transportRequestId: 'pending-r1', pipelineRunId: 'pending-run', pipelineRoundId: 'r1', status: 'GENERATING'
    };
    chrome.runtime.onMessage.addListener.mock.calls.forEach(([listener]) => listener(message, {}, jest.fn()));
    debug.updateLLMPanelOutput('Gemini', 'Later round completed.', '', {
      status: 'SUCCESS', transportRequestId: 'pending-r2', pipelineRunId: 'pending-run', pipelineRoundId: 'r2'
    });
    document.getElementById('get-it-button').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await delay(0);
    const cards = Array.from(document.querySelectorAll('.debate-model-card[data-llm-name="Gemini"]'));
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.querySelector('.debate-model-card-round').textContent)).toEqual(['R1', 'R2']);
    expect(cards.map((card) => card.querySelector('.debate-model-card-output').textContent))
      .toEqual(['Earlier round still printing.', 'Later round completed.']);
    expect(cards[0].dataset.requestId).toBe('pending-r1');
    expect(cards[0].dataset.turnClosed).toBe('false');
    expect(cards[1].querySelector('.post-terminal-badge')).toBeNull();
  });

  test('identical answers in R1 and R2 remain separate; late R1 growth updates only R1', () => {
    const debug = window.__pipelineLifecycleDebug;
    const meta = (round) => ({
      status: 'SUCCESS', requestId: `round-${round}`, pipelineRunId: 'round-isolation', pipelineRoundId: `r${round}`
    });
    debug.updateLLMPanelOutput('GPT', 'Same answer.', '', meta(1));
    debug.updateLLMPanelOutput('GPT', 'Same answer.', '', meta(2));
    const cards = Array.from(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]'));
    expect(cards).toHaveLength(2);
    expect(cards.map((card) => card.querySelector('.debate-model-card-round').textContent)).toEqual(['R1', 'R2']);
    debug.updateLLMPanelOutput('GPT', 'Same answer. Late continuation.', '', meta(1));
    expect(cards[0].querySelector('.debate-model-card-output').textContent).toContain('Late continuation.');
    expect(cards[1].querySelector('.debate-model-card-output').textContent).toBe('Same answer.');
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')).toHaveLength(2);
  });

  test('an adopted streaming round card gets its final without another card or moving the round badge', () => {
    const debug = window.__pipelineLifecycleDebug;
    const meta = { requestId: 'adopt-round', pipelineRunId: 'adopt-run', pipelineRoundId: 'r10' };
    debug.updateLLMPanelOutput('GPT', 'A partial **answer', '', { ...meta, status: 'GENERATING' });
    const card = document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    card.querySelector('.debate-approval-check').click();
    expect(card.dataset.approved).toBe('true');
    debug.updateLLMPanelOutput('GPT', 'A partial **answer** that is now complete.', '', { ...meta, status: 'SUCCESS' });
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')).toHaveLength(1);
    expect(card.dataset.turnClosed).toBe('true');
    expect(card.querySelector('.debate-model-card-output').textContent).toContain('now complete.');
    expect(card.querySelector('.debate-model-card-name').nextElementSibling.textContent).toBe('R10');
    expect(card.querySelector('.debate-model-card-round').nextElementSibling.classList.contains('debate-inline-time')).toBe(true);
  });

  test('a completed duplicate of the same round collapses without disturbing a different run', () => {
    const debug = window.__pipelineLifecycleDebug;
    const meta = { status: 'SUCCESS', requestId: 'duplicate-round', pipelineRunId: 'duplicate-run', pipelineRoundId: 'r1' };
    debug.updateLLMPanelOutput('GPT', 'Original answer.', '', meta);
    const card = document.querySelector('.debate-model-card[data-llm-name="GPT"]');
    const duplicate = card.cloneNode(true);
    duplicate.dataset.entryId = 'duplicate-round-card';
    duplicate.dataset.messageId = duplicate.dataset.entryId;
    document.getElementById('debate-model-cards').appendChild(duplicate);
    debug.updateLLMPanelOutput('GPT', 'Original answer. Extra paragraph.', '', meta);
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')).toHaveLength(1);
    expect(card.isConnected).toBe(true);
    debug.updateLLMPanelOutput('GPT', 'Original answer.', '', {
      ...meta, requestId: 'next-run-request', pipelineRunId: 'next-run'
    });
    expect(document.querySelectorAll('.debate-model-card[data-llm-name="GPT"]')).toHaveLength(2);
  });

  test('debate approval waiter rejects and cleans up on abort', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const controller = new AbortController();
    const approvalPromise = debug.waitForDebateApproval({ signal: controller.signal });
    expect(debug.getApprovalWaiting()).toBe(true);

    controller.abort();

    await expect(approvalPromise).rejects.toMatchObject({ name: 'AbortError' });
    expect(debug.getApprovalWaiting()).toBe(false);
  });

  test('debate feed mirrors cards into structured DebateEngine transcript artifact', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const card = addPendingApprovalCard({
      id: 'engine-msg-1',
      model: 'GPT',
      text: 'Structured transcript response'
    });

    card.querySelector('.debate-approval-check').click();
    await delay(20);

    const artifact = debug.collectDebateArtifact();
    const activeSession = artifact.sessions.find((session) => session.sessionId === '1');

    expect(debug.getDebateRunPolicy()).toBe('manual');
    expect(debug.getDebateRoundLimit()).toBe(3);
    expect(activeSession.settings).toEqual(expect.objectContaining({
      mode: 'universal_pipeline',
      turnLimit: 3,
      maxTurns: 4
    }));
    expect(activeSession.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({
        turnId: 'turn-engine-msg-1',
        author: 'GPT',
        authorType: 'model',
        targets: ['Moderator'],
        text: 'Structured transcript response',
        status: 'approved'
      })
    ]));
    expect(debug.collectDebateMarkdown()).toContain('## Turn');
    expect(debug.collectDebateMarkdown()).toContain('Structured transcript response');
  });

  test('debate transcript artifact can restore and render the active session', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const restored = debug.hydrateDebateTranscriptFromArtifact({
      activeSessionId: 'restore-1',
      sessions: [{
        sessionId: 'restore-1',
        title: 'Restored',
        participants: ['GPT'],
        settings: { runPolicy: 'manual', maxTurns: 5 },
        turns: [
          {
            turnId: 'turn-restore-moderator',
            sessionId: 'restore-1',
            index: 1,
            author: 'Moderator',
            authorType: 'moderator',
            targets: ['GPT'],
            text: 'Restore this debate prompt',
            status: 'approved',
            createdAt: '2026-06-11T19:00:00.000Z',
            completedAt: '2026-06-11T19:00:00.000Z',
            approvedAt: '2026-06-11T19:00:00.000Z'
          },
          {
            turnId: 'turn-restore-gpt',
            sessionId: 'restore-1',
            index: 2,
            author: 'GPT',
            authorType: 'model',
            role: 'Critic',
            targets: ['Moderator'],
            text: 'Restored transcript answer',
            status: 'approved',
            terminalStatus: 'SUCCESS',
            delivery: { pipelineRunId: 'restored-run', pipelineRoundId: 'r2', requestId: 'restored-request' },
            createdAt: '2026-06-11T19:01:00.000Z',
            completedAt: '2026-06-11T19:02:00.000Z',
            approvedAt: '2026-06-11T19:02:00.000Z'
          }
        ]
      }]
    });

    expect(restored).toBe(true);
    expect(document.querySelector('.debate-session-tab.active')?.dataset.sessionId).toBe('restore-1');
    expect(document.querySelectorAll('#debate-model-cards .debate-model-card[data-session-id="restore-1"]')).toHaveLength(2);
    expect(document.getElementById('debate-model-cards').textContent).toContain('Restore this debate prompt');
    expect(document.getElementById('debate-model-cards').textContent).toContain('Restored transcript answer');
    const restoredCard = document.querySelector('.debate-model-card[data-turn-id="turn-restore-gpt"]');
    expect(restoredCard.querySelector('.debate-model-card-name').nextElementSibling.textContent).toBe('R2');
    expect(restoredCard.querySelector('.debate-model-card-round').nextElementSibling.classList.contains('debate-inline-time')).toBe(true);

    const artifact = debug.collectDebateArtifact();
    const session = artifact.sessions.find((item) => item.sessionId === 'restore-1');
    expect(session.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-restore-gpt', terminalStatus: 'SUCCESS', status: 'approved' })
    ]));
    debug.updateLLMPanelOutput('GPT', 'Restored transcript answer More after restore.', '', {
      transportRequestId: 'restored-request', status: 'SUCCESS'
    });
    expect(document.querySelectorAll('.debate-model-card[data-turn-id="turn-restore-gpt"]')).toHaveLength(1);
    expect(restoredCard.querySelectorAll('.debate-model-card-output p')).toHaveLength(2);
    expect(restoredCard.querySelector('.debate-model-card-round').textContent).toBe('R2');
  });

  test('Action chips never become moderator dispatch text', () => {
    const debug = window.__pipelineLifecycleDebug;
    expect(document.getElementById('mod-mini-prompts').textContent).not.toContain('Role:');
    expect(document.getElementById('mod-message-body').textContent).toBe('');
    expect(debug.getModeratorDispatchText()).toBe('');
  });

  test('pipeline runtime snapshot uses R1 Pipeline UI as source of truth', () => {
    const debug = window.__pipelineLifecycleDebug;
    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.toggle('active', button.id === 'llm-gpt' || button.id === 'llm-claude');
    });
    document.dispatchEvent(new CustomEvent('llm-selection-change', {
      detail: { selected: ['GPT', 'Claude'] }
    }));
    const snapshot = debug.buildPipelineRuntimeSnapshot();

    expect(snapshot.rounds[0].stage).toBe('models');
    expect(snapshot.rounds[0].inputModels).toEqual(['Claude', 'GPT']);
    expect(snapshot.rounds[0].sendModels).toEqual(expect.arrayContaining(['GPT', 'Claude']));
    expect(snapshot.rounds[0].sendModels).toHaveLength(2);
    const gptConfig = snapshot.config.modelStacks['r1-models'].items.find((item) => item.name === 'GPT');
    expect(gptConfig).toMatchObject({
      name: 'GPT',
      input: true,
      send: true
    });
  });

  test('pipeline runtime snapshot stores universal configuration', () => {
    document.getElementById('debate-run-policy-select').value = 'auto';
    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.toggle('active', ['llm-gpt', 'llm-claude', 'llm-gemini'].includes(button.id));
    });
    document.dispatchEvent(new CustomEvent('llm-selection-change', {
      detail: { selected: ['GPT', 'Gemini', 'Claude'] }
    }));
    window.setSynthesisModelFromName('Claude');
    const snapshot = window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot();
    expect(snapshot.config.protocol).toMatchObject({
      type: 'universal', runPolicy: 'auto', synthesizer: 'Claude',
      selectedModels: ['GPT', 'Gemini', 'Claude']
    });
  });
  test('default pipeline list exposes only universal purpose profiles', () => {
    const names = Array.from(document.querySelectorAll('#pipelineItems .pipeline-item'))
      .map((item) => item.dataset.name);
    expect(names).toEqual(['Custom', 'Polishing', 'Delta', 'Test', 'Research', 'Architecture']);
    expect(document.querySelectorAll('#pipelineItems .pipeline-item-delete')).toHaveLength(0);
    // Every template, Custom included, is selectable the same way.
    document.querySelectorAll('#pipelineItems .pipeline-radio').forEach((radio) => expect(radio.disabled).toBe(false));
  });

  test('Custom turns the canvas plan into engine steps: rounds, an intermediate synthesis with its own model, the final synthesis', () => {
    const steps = window.__pipelineLifecycleDebug.customStepsFromPlan({ plannedStages: [
      { plannedStageId: 'canvas-r1', participantIds: ['GPT', 'Claude'], outputIntent: 'discussion_work' },
      { plannedStageId: 'planned-working-synthesis-after-canvas-r1', participantIds: ['Gemini'], outputIntent: 'working_synthesis' },
      { plannedStageId: 'canvas-r2', participantIds: ['GPT'], outputIntent: 'discussion_work' },
      { plannedStageId: 'planned-final-synthesis', participantIds: ['Claude'], outputIntent: 'candidate_final' }
    ] });
    expect(window.__pipelineLifecycleDebug.customStepsFromPlan({ plannedStages: [{ plannedStageId: 'canvas-r1', participantIds: [] }] }, { ref: 'r1', name: 'GPT' })[0].models.map((model) => model.name)).toEqual(['GPT']);
    expect(steps.map((step) => ({ ...step, models: step.models.map((model) => model.name) }))).toEqual([
      { kind: 'round', ref: 'r1', order: 'parallel', task: '', input: 'none', models: ['GPT', 'Claude'] },
      { kind: 'synthesis', ref: 'synth:planned-working-synthesis-after-canvas-r1', task: expect.stringContaining('Сведи'), models: ['Gemini'] },
      { kind: 'round', ref: 'r2', order: 'parallel', task: expect.stringContaining('Учти ответы'), input: 'previous', models: ['GPT'] },
      { kind: 'synthesis', ref: 'final', task: expect.stringContaining('Сведи'), models: ['Claude'] }
    ]);
  });

  test('unnamed canvas opens the real Custom editor and saves the Custom runner without a draft flag', async () => {
    const debug = window.__pipelineLifecycleDebug;
    debug.setPipelineStoreForTest({ pipelines: {}, order: [], active: '' });
    document.getElementById('pipeline-panel').removeAttribute('data-pipeline-draft');
    document.getElementById('currentPipelineName').textContent = '';
    document.getElementById('llm-gemini').click();
    expect(window.getSelectedPipelinePresetId()).toBe('CUSTOM');
    const block = [...document.querySelectorAll('#r2-models .model-block')].find((item) => item.querySelector('.model-name')?.textContent === 'Gemini');
    expect(block).toBeDefined();
    block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const modal = document.getElementById('pipeline-block-info-modal');
    expect(modal.classList.contains('custom-model-card')).toBe(true);
    expect(modal.querySelector('.custom-card-model').textContent).toContain('Gemini');
    modal.querySelector('#custom-card-request').value = 'UNNAMED REQUEST {вход}';
    modal.querySelector('#custom-card-length').value = '45';
    modal.querySelector('#custom-card-save').click();
    const config = debug.capturePipelineConfig();
    expect(config.protocol.presetId).toBe('CUSTOM');
    expect(config.customModelSettings.r2.Gemini).toEqual({ promptTemplate: 'UNNAMED REQUEST {вход}', maxWords: 45 });
    modal.remove();
  });

  test('an explicitly saved legacy pipeline retains its runner', () => {
    const debug = window.__pipelineLifecycleDebug;
    document.getElementById('pipeline-panel').removeAttribute('data-pipeline-draft');
    debug.setPipelineStoreForTest({ active: 'Legacy', order: ['Legacy'], pipelines: { Legacy: { protocol: { type: 'universal', presetId: 'UNIVERSAL_STANDARD' } } } });
    expect(window.getSelectedPipelinePresetId()).toBe('UNIVERSAL_STANDARD');
  });

  test.each(['saved', 'unnamed', 'cleared'])('Custom card sends its edited request and length through Run, including retries (%s pipeline)', async (kind) => {
    const debug = window.__pipelineLifecycleDebug;
    const config = { version: 3, roundCounter: 2, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT', 'Claude'], length: '700', roundLimit: '2', synthesizer: '', runPolicy: 'auto' }, modelStacks: {} };
    debug.setPipelineStoreForTest(kind === 'saved'
      ? { active: 'Card dispatch test', order: ['Card dispatch test'], pipelines: { 'Card dispatch test': config } }
      : { active: '', order: [], pipelines: {} });
    const header = document.getElementById('currentPipelineName');
    header.textContent = '';
    header.dataset.fullName = '';
    document.getElementById('pipeline-panel').removeAttribute('data-pipeline-draft');
    debug.applyPipelineConfig(config);
    document.getElementById('debate-run-policy-select').value = 'auto';
    window.setSynthesisModelFromName('');
    let block = [...document.querySelectorAll('#r2-models .model-block')].find((item) => item.querySelector('.model-name')?.textContent === 'GPT');
    expect(block).toBeDefined();
    const modal = document.createElement('div');
    modal.innerHTML = '<div class="modal-content"></div>';
    document.body.appendChild(modal);
    await debug.renderCustomBlockInspector(block, modal);
    const request = modal.querySelector('#custom-card-request');
    const length = modal.querySelector('#custom-card-length');
    expect(modal.querySelector('.custom-card-top img')).not.toBeNull();
    request.value = 'CARD_REQUEST {задача}\nUSE_INPUT {вход}';
    request.dispatchEvent(new Event('input'));
    length.value = '37';
    length.dispatchEvent(new Event('input'));
    modal.querySelector('#custom-card-save').click();
    const stored = await chrome.storage.local.get('llmComparatorPipelines');
    if (kind === 'saved') {
      expect(stored.llmComparatorPipelines.pipelines['Card dispatch test'].customModelSettings.r2.GPT.maxWords).toBe(37);
    }
    const saved = debug.capturePipelineConfig();
    expect(saved.customModelSettings.r2.GPT).toEqual({ promptTemplate: request.value, maxWords: 37 });
    // Reloading the saved configuration must restore the actual card controls.
    debug.applyPipelineConfig(JSON.parse(JSON.stringify(saved)));
    block = [...document.querySelectorAll('#r2-models .model-block')].find((item) => item.querySelector('.model-name')?.textContent === 'GPT');
    await debug.renderCustomBlockInspector(block, modal);
    expect(modal.querySelector('#custom-card-request').value).toBe(request.value);
    expect(modal.querySelector('#custom-card-length').value).toBe('37');
    expect(modal.querySelector('#custom-discipline-limit').value).toBe('[RESPONSE_LIMIT] Объём ответа: 1-37 слов, не больше.');
    expect(modal.querySelector('#custom-discipline-content').value).toContain('убери повторы, длинные пересказы и второстепенные детали.');
    expect([...modal.querySelectorAll('[data-discipline]')].map((row) => row.dataset.discipline)).toEqual(['task', 'limit', 'content', 'delivery', 'correction']);
    expect(modal.querySelector('#custom-discipline-ask')).toBeNull();
    for (const [key, value] of Object.entries({ limit: '[RESPONSE_LIMIT] Ответ — не более {слов} слов. PERSONAL_LIMIT', content: 'PERSONAL_CONTENT', delivery: 'PERSONAL_DELIVERY {метка}', correction: 'PERSONAL_CORRECTION: {причина}' })) {
      const row = modal.querySelector(`[data-discipline="${key}"]`);
      if (kind === 'cleared') row.querySelector('[data-action="clear"]').click();
      const field = row.querySelector('textarea');
      expect(field.readOnly).toBe(false);
      if (kind !== 'cleared') { field.value = value; field.dispatchEvent(new Event('input')); }
      row.querySelector('[data-action="save"]').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await debug.renderCustomBlockInspector(block, modal);
    expect(modal.querySelector('#custom-discipline-delivery').value).toBe(kind === 'cleared' ? 'Последней строкой ответа напиши только метку {метка}' : 'PERSONAL_DELIVERY {метка}');
    const starts = [];
    const oldDelivery = window.MessageDelivery;
    window.MessageDelivery = require('../shared/message-delivery.js');
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type !== 'START_FULLPAGE_PROCESS') { callback?.({ status: 'ok', active: false }); return; }
      starts.push(message);
      callback?.({ status: 'process_started' });
      setTimeout(() => message.selectedLLMs.forEach((name) => {
        const empty = starts.length === 2 && name === 'GPT';
        debug.pipelineWaiter.handleFinal({ type: 'LLM_RESPONSE', llmName: name,
          transportRequestId: message.pipelineContext.transportRequestIds[name],
          answer: empty ? '' : `Accepted ${name} answer from batch ${starts.length}.`,
          metadata: { ...message.pipelineContext, status: 'SUCCESS', attribution: 'verified', completion: 'complete' }
        });
      }), 0);
    });
    try {
      document.getElementById('modTa').value = 'LIVE TASK VALUE';
      await window.runPipeline();
      expect(header.textContent).toBe('LIVE TASK VALUE');
      expect(debug.capturePipelineConfig().customModelSettings.r2.GPT.maxWords).toBe(37);
      expect(starts).toHaveLength(3);
      const sent = starts[1].promptsByModel.GPT;
      expect(sent).toContain('CARD_REQUEST LIVE TASK VALUE');
      expect(sent).toContain('Accepted GPT answer from batch 1.');
      expect(sent).toContain('Accepted Claude answer from batch 1.');
      expect(sent).not.toContain('{вход}');
      if (kind === 'cleared') {
        expect(sent).toContain('[RESPONSE_LIMIT] Объём ответа: 1-37 слов');
        expect(sent).toContain('Сосредоточься на ясной концепции');
        expect(sent).toContain('Последней строкой ответа');
      } else {
        expect(sent).toContain('не более 37 слов. PERSONAL_LIMIT');
        expect(sent.indexOf('PERSONAL_CONTENT')).toBeGreaterThan(sent.indexOf('PERSONAL_LIMIT'));
        expect(sent.indexOf('PERSONAL_DELIVERY')).toBeGreaterThan(sent.indexOf('PERSONAL_CONTENT'));
        expect(sent).toContain('PERSONAL_DELIVERY [[AO-');
        expect(sent.match(/\[(?:DISPUT_)?RESPONSE_LIMIT\]/g)).toHaveLength(1);
      }
      expect(sent).not.toContain('PERSONAL_ASK'); // Auto does not ask the owner.
      expect(sent).toMatch(/\[\[AO-[a-z0-9]+\]\]/i);
      expect(starts[0].promptsByModel.GPT).toContain('Объём ответа: 650-700 слов, не больше.');
      expect(starts[0].promptsByModel.GPT).not.toContain('CARD_REQUEST');
      expect(starts[1].promptsByModel.CLAUDE).toContain('Объём ответа: 650-700 слов, не больше.');
      expect(starts[1].promptsByModel.CLAUDE).not.toContain('CARD_REQUEST');
      expect(starts[1].promptsByModel.CLAUDE).not.toContain('PERSONAL_');
      expect(starts[0].promptsByModel.GPT).not.toContain('PERSONAL_');
      expect(starts[2].selectedLLMs).toEqual(['GPT']);
      if (kind === 'cleared') expect(starts[2].promptsByModel.GPT).toContain('[RESPONSE_LIMIT] Объём ответа: 1-37 слов');
      else {
        expect(starts[2].promptsByModel.GPT).toContain('PERSONAL_CORRECTION:');
        expect(starts[2].promptsByModel.GPT).not.toContain('Твой предыдущий ответ');
        expect(starts[2].promptsByModel.GPT).toContain('не более 37 слов. PERSONAL_LIMIT');
        expect(starts[2].promptsByModel.GPT).toContain('PERSONAL_DELIVERY [[AO-');
      }
    } finally {
      window.MessageDelivery = oldDelivery;
      debug.pipelineWaiter.reset();
      modal.remove();
    }
  });

  test('the Custom model card rejects empty requests and invalid lengths; reset and inherited length persist', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const config = { version: 3, roundCounter: 1, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT'], roundLimit: '1', synthesizer: '', runPolicy: 'auto' }, modelStacks: {} };
    debug.setPipelineStoreForTest({ active: 'Card validation test', order: ['Card validation test'], pipelines: { 'Card validation test': config } });
    debug.applyPipelineConfig(config);
    const block = document.querySelector('#r1-models .model-block');
    const modal = document.createElement('div');
    modal.innerHTML = '<div class="modal-content"></div>';
    document.body.appendChild(modal);
    await debug.renderCustomBlockInspector(block, modal);
    const request = modal.querySelector('#custom-card-request');
    const length = modal.querySelector('#custom-card-length');
    expect(length.value).toBe(document.getElementById('debate-length-select').value);
    expect(modal.querySelector('[data-copy-field="custom-card-length"]')).toBeNull();
    const original = request.value;
    request.value = '';
    modal.querySelector('#custom-card-save').click();
    expect(debug.capturePipelineConfig().customModelSettings).toEqual({});
    request.value = 'Edited request';
    length.value = '0';
    modal.querySelector('#custom-card-save').click();
    expect(debug.capturePipelineConfig().customModelSettings).toEqual({});
    length.value = '1.5';
    modal.querySelector('#custom-card-save').click();
    expect(debug.capturePipelineConfig().customModelSettings).toEqual({});
    modal.querySelector('#custom-card-reset').click();
    expect(request.value).toBe(original);
    length.value = '';
    modal.querySelector('#custom-card-save').click();
    expect(debug.capturePipelineConfig().customModelSettings.r1.GPT).toEqual({ promptTemplate: null, maxWords: null });
    const limited = (text) => debug.prepareCustomPrompts(['GPT'], { GPT: text }, { GPT: 44 }).GPT;
    for (const stale of ['[RESPONSE_LIMIT] stale 999 words', '[DISPUT_RESPONSE_LIMIT] stale 999 words']) {
      const sent = limited(`TEST\n${stale}`);
      expect(sent).toContain('Объём ответа: 1-44 слов, не больше.');
      expect(sent).not.toContain('999');
      expect(sent.match(/\[(?:DISPUT_)?RESPONSE_LIMIT\]/g)).toHaveLength(1);
    }
    modal.remove();
  });

  test('Custom length and content are separate, with compatible old defaults and independent clearing', () => {
    const prepare = window.__pipelineLifecycleDebug.prepareCustomPrompts;
    const oldContent = 'Сосредоточься на ясной концепции и ключевых идеях; убери повторы, длинные пересказы и второстепенные детали.';
    const prompt = prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }).GPT;
    expect(prompt).toContain('[RESPONSE_LIMIT] Объём ответа: 250-300 слов, не больше.\n\n' + oldContent);
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { limit: '', content: oldContent } }).GPT).toBe(prompt);
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { content: '' } }).GPT).toBe(prompt);
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { limit: '' } }).GPT).toBe(prompt);
    const legacy = '[RESPONSE_LIMIT] Ответ — не более {слов} слов. ' + oldContent;
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { limit: legacy } }).GPT).toBe(prompt);
    // Settings saved before the marker was renamed keep working and still follow the shared default.
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { limit: legacy.replace('[RESPONSE_LIMIT]', '[DISPUT_RESPONSE_LIMIT]') } }).GPT).toBe(prompt);
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { limit: '[DISPUT_RESPONSE_LIMIT] Объём ответа: {от}-{слов} слов, не больше.' } }).GPT).toBe(prompt);
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { limit: '[DISPUT_RESPONSE_LIMIT] Свой лимит {слов}.' } }).GPT).toContain('[RESPONSE_LIMIT] Свой лимит 300.');
  });

  test('Custom own lines follow the content requirements, trimmed, one paragraph each, also on corrections', () => {
    const prepare = window.__pipelineLifecycleDebug.prepareCustomPrompts;
    const base = prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }).GPT;
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { lines: ['  OWN ONE  ', '', 'OWN TWO'] } }).GPT).toBe(base + '\n\nOWN ONE\n\nOWN TWO');
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { lines: ['   '] } }).GPT).toBe(base);
    expect(prepare(['GPT'], { GPT: 'T' }, { GPT: 300 }, { GPT: { lines: ['OWN'] } }, {}, { GPT: 'fix' }).GPT).toBe(base + '\n\nOWN');
  });

  test('Custom card «+» adds own lines, saves only non-empty ones, and «×» removes a line', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const config = { version: 3, roundCounter: 2, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT', 'Claude'], length: '700', roundLimit: '2', synthesizer: '', runPolicy: 'auto' }, modelStacks: {} };
    debug.setPipelineStoreForTest({ active: '', order: [], pipelines: {} });
    document.getElementById('pipeline-panel').removeAttribute('data-pipeline-draft');
    debug.applyPipelineConfig(config);
    const block = [...document.querySelectorAll('#r2-models .model-block')].find((item) => item.querySelector('.model-name')?.textContent === 'GPT');
    const modal = document.createElement('div');
    modal.innerHTML = '<div class="modal-content"></div>';
    document.body.appendChild(modal);
    await debug.renderCustomBlockInspector(block, modal);
    modal.querySelector('#custom-card-line-add').click();
    modal.querySelector('#custom-card-line-add').click();
    expect(modal.querySelectorAll('[data-line]')).toHaveLength(2);
    expect(modal.querySelector('[data-line="0"] [data-action="inherit"]')).toBeNull();
    modal.querySelector('#custom-line-0').value = '  OWN  ';
    modal.querySelector('#custom-line-0').dispatchEvent(new Event('input'));
    modal.querySelector('#custom-card-save').click();
    expect(debug.capturePipelineConfig().customModelSettings.r2.GPT.discipline.lines).toEqual(['OWN']);
    await debug.renderCustomBlockInspector(block, modal);
    expect(modal.querySelector('#custom-line-0').value).toBe('OWN');
    expect(modal.querySelectorAll('[data-line]')).toHaveLength(1);
    modal.querySelector('[data-line="0"] [data-action="remove"]').click();
    expect(modal.querySelectorAll('[data-line]')).toHaveLength(0);
    modal.querySelector('#custom-card-save').click();
    expect(debug.capturePipelineConfig().customModelSettings.r2.GPT.discipline).toBeUndefined();
    modal.remove();
  });

  test.each(['input', 'limit', 'content', 'delivery', 'correction', 'token'])('Custom stops without dispatch or compaction when the full %s overflows', async (part) => {
    const debug = window.__pipelineLifecycleDebug;
    const originalBudget = window.DebateContextBudget;
    const originalDelivery = window.MessageDelivery;
    const budget = require('../disput/debate-context-budget');
    const compact = jest.fn(budget.compactPrompt);
    const delivery = require('../shared/message-delivery');
    delivery.reset();
    const discipline = { limit: 'L', content: 'C', delivery: 'D', ask: 'A', correction: 'RETRY' };
    if (part !== 'input' && part !== 'token') discipline[part] = 'Z'.repeat(700);
    const promptTemplate = part === 'input' ? 'X'.repeat(700) : 'X';
    const config = { version: 3, roundCounter: 1, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT'], roundLimit: '1', synthesizer: '', runPolicy: part === 'ask' ? 'manual' : 'auto' }, modelStacks: {},
      customModelSettings: { r1: { GPT: { promptTemplate, discipline } } } };
    debug.setPipelineStoreForTest({ active: 'Budget check', pipelines: { 'Budget check': config }, order: ['Budget check'] });
    debug.applyPipelineConfig(config);
    window.setSynthesisModelFromName('');
    document.getElementById('debate-run-policy-select').value = config.protocol.runPolicy;
    const starts = [];
    window.MessageDelivery = delivery;
    window.DebateContextBudget = { ...budget, DEFAULT_LIMITS: { promptChars: part === 'token' ? 11 : 600, reservedOutputChars: 0 }, compactPrompt: compact };
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type !== 'START_FULLPAGE_PROCESS') { callback?.({ status: 'ok', active: false }); return; }
      starts.push(message);
      callback?.({ status: 'process_started' });
      setTimeout(() => debug.pipelineWaiter.handleFinal({ type: 'LLM_RESPONSE', llmName: 'GPT',
        transportRequestId: message.pipelineContext.transportRequestIds.GPT, answer: '',
        metadata: { ...message.pipelineContext, status: 'SUCCESS', attribution: 'verified', completion: 'complete' } }), 0);
    });
    try {
      document.getElementById('modTa').value = 'Budget test';
      await window.runPipeline();
      expect(starts).toHaveLength(part === 'correction' ? 1 : 0);
      expect(compact).not.toHaveBeenCalled();
      expect(delivery.journal().filter((event) => event.kind === 'custom_end').at(-1).stopReason).toBe('context_full');
    } finally {
      window.DebateContextBudget = originalBudget;
      window.MessageDelivery = originalDelivery;
      debug.pipelineWaiter.reset();
    }
  });

  const settleCustomCard = () => new Promise((resolve) => setTimeout(resolve, 0));
  const setupCustomInheritance = (name, { synthesis = '' } = {}) => {
    const debug = window.__pipelineLifecycleDebug;
    const config = { version: 3, roundCounter: 2, protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT', 'Claude'], length: '300', roundLimit: '2', synthesizer: synthesis, runPolicy: 'auto' }, modelStacks: {} };
    debug.setPipelineStoreForTest({ active: name, pipelines: { [name]: config }, order: [name] });
    debug.applyPipelineConfig(config);
    document.getElementById('debate-run-policy-select').value = 'auto';
    window.setSynthesisModelFromName(synthesis);
    const oldDelivery = window.MessageDelivery;
    window.MessageDelivery = require('../shared/message-delivery');
    const starts = [];
    let failSecondRound = false;
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type !== 'START_FULLPAGE_PROCESS') { callback?.({ status: 'ok', active: false }); return; }
      starts.push(message);
      const batchNumber = starts.length;
      callback?.({ status: 'process_started' });
      setTimeout(() => message.selectedLLMs.forEach((model) => debug.pipelineWaiter.handleFinal({ type: 'LLM_RESPONSE', llmName: model,
        transportRequestId: message.pipelineContext.transportRequestIds[model],
        answer: failSecondRound && batchNumber === 2 && model === 'GPT' ? '' : `Accepted ${model} response ${batchNumber}.`,
        metadata: { ...message.pipelineContext, status: 'SUCCESS', attribution: 'verified', completion: 'complete' }
      })), 0);
    });
    const modal = () => document.getElementById('pipeline-block-info-modal');
    const openGeneral = () => { document.getElementById('entryPoint').click(); return modal(); };
    const openModel = (model = 'GPT') => {
      [...document.querySelectorAll('#r2-models .model-block')].find((block) => block.querySelector('.model-name')?.textContent === model)
        .dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      return modal();
    };
    const edit = async (card, values) => {
      for (const [key, value] of Object.entries(values)) {
        const field = card.querySelector(key === 'promptTemplate' ? '#custom-card-request' : `#custom-discipline-${key}`);
        field.value = value;
        field.dispatchEvent(new Event('input'));
      }
      card.querySelector('#custom-card-save').click();
      await settleCustomCard();
    };
    return { debug, config, starts, modal, openGeneral, openModel,
      general: (values) => edit(openGeneral(), values),
      model: (values) => edit(openModel(), values),
      async run({ retry = false } = {}) {
        modal()?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        starts.length = 0; failSecondRound = retry;
        document.getElementById('modTa').value = 'INHERITANCE TASK';
        await window.runPipeline();
        return starts;
      },
      cleanup() { window.MessageDelivery = oldDelivery; debug.pipelineWaiter.reset(); modal()?.remove(); }
    };
  };

  test('Custom run: canvas blocks and links follow the engine stages, synthesis blocks included, and end done', async () => {
    const h = setupCustomInheritance('Custom canvas progress', { synthesis: 'Gemini' });
    const gates = [0, 1, 2].map(() => { let open = null; const promise = new Promise((resolve) => { open = resolve; }); return { promise, open }; });
    const answerLater = (message, batchNumber) => setTimeout(() => message.selectedLLMs.forEach((model) => h.debug.pipelineWaiter.handleFinal({ type: 'LLM_RESPONSE', llmName: model,
      transportRequestId: message.pipelineContext.transportRequestIds[model],
      answer: `Accepted ${model} response ${batchNumber}.`,
      metadata: { ...message.pipelineContext, status: 'SUCCESS', attribution: 'verified', completion: 'complete' }
    })), 0);
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.type !== 'START_FULLPAGE_PROCESS') { callback?.({ status: 'ok', active: false }); return; }
      h.starts.push(message);
      const batchNumber = h.starts.length;
      callback?.({ status: 'process_started' });
      // Each batch is answered only when the test opens its gate: the run stays in that stage meanwhile.
      if (gates[batchNumber - 1]) gates[batchNumber - 1].promise.then(() => answerLater(message, batchNumber));
    });
    const state = (selector) => document.querySelector(`${selector} .model-block`).className;
    const link = (id) => document.getElementById(id).closest('.connector-group').className;
    const until = async (check) => { for (let i = 0; i < 200 && !check(); i += 1) await delay(0); };
    try {
      document.getElementById('modTa').value = 'CANVAS PROGRESS';
      const running = window.runPipeline();
      await until(() => h.starts.length === 1);
      expect(state('#round1')).toContain('pipeline-run-running');
      expect(state('#round2')).toContain('pipeline-run-pending');
      expect(link('svg-r1-r2')).toContain('pipeline-link-pending');
      gates[0].open();

      await until(() => h.starts.length === 2);
      expect(state('#round1')).toContain('pipeline-run-done');
      expect(state('#round2')).toContain('pipeline-run-running');
      expect(link('svg-r1-r2')).toContain('pipeline-link-running');
      gates[1].open();

      await until(() => h.starts.length === 3);
      expect(state('#round2')).toContain('pipeline-run-done');
      expect(link('svg-r1-r2')).toContain('pipeline-link-done');
      const synth = () => document.querySelector('#synthesis-stack .pipeline-synthesis-block').className;
      expect(synth()).toContain('pipeline-run-running');
      expect(synth()).not.toContain('pipeline-run-done');
      gates[2].open();
      await running;

      // Run over: every stage is done and nothing keeps pulsing; the synthesis block is blue like the rounds.
      expect(state('#round1')).toContain('pipeline-run-done');
      expect(state('#round2')).toContain('pipeline-run-done');
      expect(synth()).toContain('pipeline-run-done');
      expect(document.querySelectorAll('.pipeline-run-running, .pipeline-link-running').length).toBe(0);
      expect(link('svg-r-last-synthesis')).toContain('pipeline-link-done');
    } finally {
      gates.forEach((gate) => gate.open());
      h.cleanup();
    }
  }, 30000);

  test('Custom omits owner-question instructions in manual mode, including old saved overrides', async () => {
    const h = setupCustomInheritance('No owner instruction');
    try {
      const config = { ...h.config, roundCounter: 1,
        protocol: { ...h.config.protocol, roundLimit: '1', runPolicy: 'manual' },
        customDefaults: { discipline: { ask: 'OLD_SHARED_ASK' } },
        customModelSettings: { r1: { GPT: { discipline: { ask: 'OLD_MODEL_ASK' } } } } };
      h.debug.applyPipelineConfig(config);
      document.getElementById('debate-run-policy-select').value = 'manual';
      expect(h.openGeneral().querySelector('#custom-discipline-ask')).toBeNull();
      await h.run();
      expect(h.starts).toHaveLength(1);
      for (const prompt of Object.values(h.starts[0].promptsByModel)) {
        expect(prompt).not.toContain('[[ASK:');
        expect(prompt).not.toContain('OLD_SHARED_ASK');
        expect(prompt).not.toContain('OLD_MODEL_ASK');
      }
    } finally { h.cleanup(); }
  });

  test('Custom ▶ tasks and discipline reach dispatch in R2+ and synthesis without copying to models', async () => {
    const h = setupCustomInheritance('General dispatch', { synthesis: 'Gemini' });
    try {
      const general = h.openGeneral();
      expect(general.querySelector('#custom-card-request')).toBeNull();
      expect(general.querySelector('#custom-card-length')).toBeNull();
      await h.general({ roundTask: 'ROUND_GENERAL_A', synthesisTask: 'SYNTHESIS_GENERAL_A', content: 'CONTENT_GENERAL_A', delivery: 'DELIVERY_GENERAL {метка}', correction: 'FIX_GENERAL {причина}' });
      expect(h.debug.capturePipelineConfig().customModelSettings).toEqual({});
      await h.run();
      expect(h.starts).toHaveLength(3);
      for (const model of ['GPT', 'CLAUDE']) {
        expect(h.starts[0].promptsByModel[model]).not.toContain('ROUND_GENERAL_A');
        expect(h.starts[1].promptsByModel[model]).toContain('ROUND_GENERAL_A');
        expect(h.starts[1].promptsByModel[model]).toContain('CONTENT_GENERAL_A');
        expect(h.starts[1].promptsByModel[model]).toContain('DELIVERY_GENERAL [[AO-');
      }
      expect(h.starts[2].promptsByModel.GEMINI).toContain('SYNTHESIS_GENERAL_A');
      await h.general({ roundTask: 'ROUND_GENERAL_B', content: 'CONTENT_GENERAL_B' });
      await h.run({ retry: true });
      expect(h.starts[1].promptsByModel.GPT).toContain('ROUND_GENERAL_B');
      expect(h.starts[2].promptsByModel.GPT).toContain('FIX_GENERAL');
      expect(h.starts[2].promptsByModel.GPT).toContain('CONTENT_GENERAL_B');
      expect(h.debug.capturePipelineConfig().customModelSettings).toEqual({});
      expect(h.openModel().querySelector('[data-source-for]')).toBeNull();
    } finally { h.cleanup(); }
  }, 30000);

  const setBlockRole = (block, promptId) => {
    const select = block.querySelector('.role-selector');
    select.value = promptId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const canvasBlock = (stackId, model) => [...document.querySelectorAll(`#${stackId} .model-block`)]
    .find((block) => block.querySelector('.model-name')?.textContent === model);
  const openRoundCard = (round) => {
    require('../results/stage-card');
    if (!document.getElementById('pipeline-stage-dialog')) {
      document.body.insertAdjacentHTML('beforeend', '<dialog id="pipeline-stage-dialog"><h2 id="pipeline-stage-dialog-title"></h2><div id="pipeline-stage-card"></div></dialog>');
    }
    const dialog = document.getElementById('pipeline-stage-dialog');
    if (typeof dialog.showModal !== 'function') dialog.showModal = () => dialog.setAttribute('open', '');
    // The fixture has no badges; the real panel markup (pipeline_panel.html) puts one in each round column.
    const column = document.getElementById(`round${round}`);
    if (!column.querySelector('.round-badge')) column.insertAdjacentHTML('afterbegin', `<div class="stage-label"><span class="round-badge">R${round}</span></div>`);
    column.querySelector('.round-badge').click();
    return document.getElementById('pipeline-stage-card');
  };
  const answerRoleConfirm = async (confirmed) => {
    document.getElementById(confirmed ? 'delete-confirm' : 'cancel-confirm').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  test('Custom block role reaches its model as extra; the round card sets one role for all blocks after confirmation', async () => {
    const h = setupCustomInheritance('Role test');
    try {
      setBlockRole(canvasBlock('r2-models', 'GPT'), 'interaction_critical_audit');
      await h.run();
      expect(h.starts).toHaveLength(2);
      expect(h.starts[1].promptsByModel.GPT).toContain('Дополнительно для тебя:\nПроведи экспертный аудит');
      expect(h.starts[1].promptsByModel.CLAUDE).not.toContain('Дополнительно для тебя');
      expect(h.starts[0].promptsByModel.GPT).not.toContain('Дополнительно для тебя');

      // Round card (round 2 has selectors): no participant list, one select with the mini-requests.
      // GPT's own role and an empty one differ: the select shows «разные».
      const card = openRoundCard(2);
      expect(card.textContent).not.toContain('Участники раунда');
      const roundSelect = card.querySelector('.stage-card-role-select');
      expect([...roundSelect.options].map((option) => option.textContent)).toEqual(['разные', 'None', 'Synthes', 'Critique', 'Select ideas', 'Clustering', 'Custom']);
      expect(roundSelect.value).toBe('mixed');

      // Replacing mixed roles asks first; Cancel changes nothing.
      roundSelect.value = 'interaction_pattern_clustering';
      roundSelect.dispatchEvent(new Event('change'));
      await answerRoleConfirm(false);
      expect(roundSelect.value).toBe('mixed');
      expect(canvasBlock('r2-models', 'GPT').querySelector('.role-selector').value).toBe('interaction_critical_audit');
      expect(canvasBlock('r2-models', 'Claude').querySelector('.role-selector').value).toBe('');

      // Confirmed: every block of the round gets the chosen role.
      roundSelect.value = 'interaction_pattern_clustering';
      roundSelect.dispatchEvent(new Event('change'));
      await answerRoleConfirm(true);
      expect(canvasBlock('r2-models', 'GPT').querySelector('.role-selector').value).toBe('interaction_pattern_clustering');
      expect(canvasBlock('r2-models', 'Claude').querySelector('.role-selector').value).toBe('interaction_pattern_clustering');

      // A personal choice in one block overrides the round's role for that block only.
      setBlockRole(canvasBlock('r2-models', 'Claude'), 'interaction_meta_synthesis');
      await h.run();
      expect(h.starts[1].promptsByModel.CLAUDE).toContain('Дополнительно для тебя:\nПострой собственное экспертное решение');
      expect(h.starts[1].promptsByModel.GPT).toContain('Дополнительно для тебя:\nСгруппируй идеи');

      // None is a real choice: the roles differ now, so the replacement is confirmed first.
      const roundAgain = openRoundCard(2).querySelector('.stage-card-role-select');
      roundAgain.value = '';
      roundAgain.dispatchEvent(new Event('change'));
      await answerRoleConfirm(true);
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).not.toContain('Дополнительно для тебя');
      expect(h.starts[1].promptsByModel.CLAUDE).not.toContain('Дополнительно для тебя');
    } finally { h.cleanup(); }
  }, 30000);

  test('Custom role «Custom» sends the round text to the blocks that chose it; other roles and an empty text stay as they are', async () => {
    const h = setupCustomInheritance('Round custom text');
    try {
      // Custom is offered by the Custom engine's selectors only; round 1 has selectors too.
      expect([...canvasBlock('r2-models', 'GPT').querySelectorAll('.role-selector option')].map((option) => option.value)).toContain('custom');
      expect([...canvasBlock('r1-models', 'GPT').querySelectorAll('.role-selector option')].map((option) => option.value)).toContain('custom');
      expect(document.querySelectorAll('#r1-models .role-selector')).toHaveLength(2);

      // The round card shows the text field only while Custom is selected.
      const card = openRoundCard(2);
      const roundSelect = card.querySelector('.stage-card-role-select');
      const area = card.querySelector('.stage-card-role-prompt');
      expect(area.hidden).toBe(true);
      roundSelect.value = 'custom';
      roundSelect.dispatchEvent(new Event('change'));
      await answerRoleConfirm(true);
      expect(area.hidden).toBe(false);
      area.value = 'ROUND_CUSTOM_TEXT';
      area.dispatchEvent(new Event('change'));
      await delay(0);
      expect(h.debug.capturePipelineConfig().customDefaults.roundPrompts).toEqual({ r2: 'ROUND_CUSTOM_TEXT' });
      const stored = await chrome.storage.local.get('llmComparatorPipelines');
      expect(stored.llmComparatorPipelines.pipelines['Round custom text'].customDefaults.roundPrompts).toEqual({ r2: 'ROUND_CUSTOM_TEXT' });

      // Claude keeps its own role; GPT takes the round's text.
      setBlockRole(canvasBlock('r2-models', 'Claude'), 'interaction_critical_audit');
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).toContain('Дополнительно для тебя:\nROUND_CUSTOM_TEXT');
      expect(h.starts[1].promptsByModel.CLAUDE).toContain('Дополнительно для тебя:\nПроведи экспертный аудит');
      expect(h.starts[1].promptsByModel.CLAUDE).not.toContain('ROUND_CUSTOM_TEXT');
      expect(h.starts[0].promptsByModel.GPT).not.toContain('ROUND_CUSTOM_TEXT');

      // The selection survives a redraw of the stack (saved and loaded again).
      const saved = JSON.parse(JSON.stringify(h.debug.capturePipelineConfig()));
      h.debug.applyPipelineConfig(saved);
      expect(canvasBlock('r2-models', 'GPT').querySelector('.role-selector').value).toBe('custom');
      expect(canvasBlock('r2-models', 'Claude').querySelector('.role-selector').value).toBe('interaction_critical_audit');
      expect(openRoundCard(2).querySelector('.stage-card-role-prompt').value).toBe('ROUND_CUSTOM_TEXT');

      // An empty round text adds no extra line.
      const emptyCard = openRoundCard(2);
      const emptyArea = emptyCard.querySelector('.stage-card-role-prompt');
      emptyArea.value = '';
      emptyArea.dispatchEvent(new Event('change'));
      await delay(0);
      expect(h.debug.capturePipelineConfig().customDefaults.roundPrompts).toBeUndefined();
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).not.toContain('Дополнительно для тебя');
    } finally { h.cleanup(); }
  }, 30000);

  test('R1 blocks have a role list; a role on one R1 model reaches only its R1 prompt and is saved and restored', async () => {
    const h = setupCustomInheritance('R1 role');
    try {
      // Same selectors as R2+: None by default, Custom on the Custom engine, the round card too.
      expect(canvasBlock('r1-models', 'GPT').querySelector('.role-selector').value).toBe('');
      expect(openRoundCard(1).querySelector('.stage-card-role-select')).not.toBeNull();

      setBlockRole(canvasBlock('r1-models', 'GPT'), 'interaction_critical_audit');
      await h.run();
      expect(h.starts[0].promptsByModel.GPT).toContain('INHERITANCE TASK');
      expect(h.starts[0].promptsByModel.GPT).toContain('Дополнительно для тебя:\nПроведи экспертный аудит');
      expect(h.starts[0].promptsByModel.CLAUDE).not.toContain('Дополнительно для тебя');
      expect(h.starts[1].promptsByModel.GPT).not.toContain('Дополнительно для тебя');

      const saved = JSON.parse(JSON.stringify(h.debug.capturePipelineConfig()));
      expect(saved.modelStacks['r1-models'].items.find((item) => item.name === 'GPT').role).toBe('interaction_critical_audit');
      expect(saved.modelStacks['r1-models'].items.find((item) => item.name === 'CLAUDE' || item.name === 'Claude').role).toBeNull();
      h.debug.applyPipelineConfig(saved);
      expect(canvasBlock('r1-models', 'GPT').querySelector('.role-selector').value).toBe('interaction_critical_audit');
    } finally { h.cleanup(); }
  }, 30000);

  test('Custom is not offered on a pipeline that does not run on the Custom engine', () => {
    const h = setupCustomInheritance('Universal roles');
    try {
      const config = { ...h.config, protocol: { ...h.config.protocol, presetId: 'UNIVERSAL_STANDARD' } };
      h.debug.setPipelineStoreForTest({ active: 'Universal roles', pipelines: { 'Universal roles': config }, order: ['Universal roles'] });
      h.debug.applyPipelineConfig(config);
      expect(document.querySelectorAll('#r2-models .role-selector')).not.toHaveLength(0);
      expect(document.querySelectorAll('#r2-models .role-selector option[value="custom"]')).toHaveLength(0);
    } finally { h.cleanup(); }
  });

  test('a personal request in a Custom block notes that its role is not applied and sends no role text', async () => {
    const h = setupCustomInheritance('Role note');
    try {
      setBlockRole(canvasBlock('r2-models', 'GPT'), 'interaction_critical_audit');
      await h.model({ promptTemplate: 'PERSONAL_NOTE_REQ {задача}' });
      expect(h.openModel('GPT').textContent).toContain('Роль не применяется: используется персональный запрос.');
      expect(h.openModel('Claude').textContent).not.toContain('Роль не применяется');
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).toContain('PERSONAL_NOTE_REQ');
      expect(h.starts[1].promptsByModel.GPT).not.toContain('Дополнительно для тебя');
    } finally { h.cleanup(); }
  }, 30000);

  test('an intermediate synthesis opens its own Custom card; its personal request reaches its model', async () => {
    const h = setupCustomInheritance('Intermediate card', { synthesis: 'Gemini' });
    try {
      // The fixture has no insert buttons; the real panel puts one after each round.
      const column = document.getElementById('round1');
      if (!column.querySelector('.pipeline-stage-insert')) column.insertAdjacentHTML('afterbegin', '<button type="button" class="pipeline-stage-insert" data-after-stage-id="canvas-r1"></button>');
      const insert = column.querySelector('.pipeline-stage-insert');
      // The double click cancels the pending single-click toggle and opens the card; the stage is not added.
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      insert.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await delay(300);
      expect(insert.classList.contains('has-intermediate-synthesis')).toBe(false);
      const modal = h.modal();
      expect(modal.querySelector('.custom-card-model').textContent).toContain('Gemini');
      modal.querySelector('#custom-card-request').value = 'SYNTH_PERSONAL {вход}';
      modal.querySelector('#custom-card-save').click();
      await delay(0);
      expect(h.debug.capturePipelineConfig().customModelSettings['synth:planned-working-synthesis-after-canvas-r1'].Gemini)
        .toEqual({ promptTemplate: 'SYNTH_PERSONAL {вход}', maxWords: null });
      // The saved text applies once a single click adds the stage.
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      expect(insert.classList.contains('has-intermediate-synthesis')).toBe(true);
      await h.run();
      expect(h.starts[1].promptsByModel.GEMINI).toContain('SYNTH_PERSONAL');
      expect(h.starts[1].promptsByModel.GEMINI).not.toContain('{вход}');
    } finally { h.cleanup(); }
  }, 30000);

  test('a single click on an intermediate insert toggles it after a short wait', async () => {
    const h = setupCustomInheritance('Intermediate toggle', { synthesis: 'Gemini' });
    try {
      const column = document.getElementById('round1');
      if (!column.querySelector('.pipeline-stage-insert')) column.insertAdjacentHTML('afterbegin', '<button type="button" class="pipeline-stage-insert" data-after-stage-id="canvas-r1"></button>');
      const insert = column.querySelector('.pipeline-stage-insert');
      // The click handler reaches the toggle only through this bridge; without it nothing is added.
      expect(typeof window.__toggleIntermediateSynthesis).toBe('function');
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(insert.classList.contains('has-intermediate-synthesis')).toBe(false);
      await delay(300);
      expect(insert.classList.contains('has-intermediate-synthesis')).toBe(true);
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      expect(insert.classList.contains('has-intermediate-synthesis')).toBe(false);
    } finally { h.cleanup(); }
  }, 30000);

  test('an intermediate synthesis block has the final block design, no header text, and its own model select', async () => {
    const h = setupCustomInheritance('Intermediate block', { synthesis: 'Gemini' });
    try {
      const column = document.getElementById('round1');
      if (!column.querySelector('.pipeline-stage-insert')) column.insertAdjacentHTML('afterbegin', '<button type="button" class="pipeline-stage-insert" data-after-stage-id="canvas-r1"></button>');
      const insert = column.querySelector('.pipeline-stage-insert');
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      const synthColumn = document.querySelector('.stage-column.pipeline-intermediate-synth');
      expect(synthColumn).not.toBeNull();
      // No "Synthesis" text: the header is empty and the insert button sits in it.
      expect(synthColumn.querySelector('.pipeline-intermediate-synth-header').textContent.trim()).toBe('');
      expect(synthColumn.querySelector('.pipeline-intermediate-synth-header .pipeline-stage-insert')).toBe(insert);
      // The block is the final synthesis block's markup: status indicator, constant «Synthesis» label, model select.
      const block = synthColumn.querySelector('.model-block.pipeline-synthesis-block');
      expect(block.querySelector('.status-indicator')).not.toBeNull();
      expect(block.querySelector('.model-name').textContent).toBe('Synthesis');
      const select = block.querySelector('select.synthesis-flow-select');
      expect(select.value).toBe('Gemini');
      // Choosing a model in the select sets this stage's participant.
      select.value = 'Claude';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await delay(0);
      const stage = window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan())
        .plannedStages.find((item) => item.outputIntent === 'working_synthesis');
      expect(stage.participantIds).toEqual(['Claude']);
      expect(block.querySelector('.model-name').textContent).toBe('Synthesis');
      // A single click on the insert removes the stage and the button returns to its round.
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      expect(document.querySelector('.stage-column.pipeline-intermediate-synth')).toBeNull();
      expect(insert.parentElement).toBe(column);
    } finally { h.cleanup(); }
  }, 30000);

  test('the insert after the last round is hidden; the insert between two rounds stays', () => {
    const h = setupCustomInheritance('Insert hidden', { synthesis: 'GPT' });
    try {
      const inserts = ['round1', 'round2'].map((id, index) => {
        const column = document.getElementById(id);
        if (!column.querySelector('.pipeline-stage-insert')) column.insertAdjacentHTML('afterbegin', `<button type="button" class="pipeline-stage-insert" data-after-stage-id="canvas-r${index + 1}"></button>`);
        return column.querySelector('.pipeline-stage-insert');
      });
      window.__syncStageInsertControls();
      expect(inserts[0].hidden).toBe(false);
      expect(inserts[1].hidden).toBe(true);
    } finally { h.cleanup(); }
  }, 30000);

  test('with no final synthesizer the final block stays in place, inactive, with its select disabled', async () => {
    const h = setupCustomInheritance('Final off block', { synthesis: '' });
    try {
      await delay(0);
      const block = document.querySelector('#synthesis-stack .pipeline-synthesis-block');
      expect(block).not.toBeNull();
      expect(document.getElementById('synthesisColumn').classList.contains('pipeline-final-off')).toBe(true);
      expect(block.classList.contains('inactive')).toBe(true);
      expect(block.classList.contains('selected-synthesizer')).toBe(false);
      expect(block.querySelector('.model-name').textContent).toBe('Synthesis');
      expect(document.getElementById('synthesis-flow-select').disabled).toBe(true);
    } finally { h.cleanup(); }
  }, 30000);

  test('an intermediate synthesis is added with the final synthesis OFF and uses Claude', async () => {
    const h = setupCustomInheritance('Intermediate without final', { synthesis: '' });
    try {
      await delay(0);
      const column = document.getElementById('round1');
      if (!column.querySelector('.pipeline-stage-insert')) column.insertAdjacentHTML('afterbegin', '<button type="button" class="pipeline-stage-insert" data-after-stage-id="canvas-r1"></button>');
      const insert = column.querySelector('.pipeline-stage-insert');
      expect(document.getElementById('synthesisColumn').classList.contains('pipeline-final-off')).toBe(true);
      expect(insert.disabled).toBe(false);
      insert.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      expect(insert.classList.contains('has-intermediate-synthesis')).toBe(true);
      const plan = window.__pipelineDraftPlanForCanvas(window.__getActivePipelineDraftPlan());
      expect(window.__getDraftPlanSynthesizer(plan)).toBe('');
      const stage = plan.plannedStages.find((item) => item.outputIntent === 'working_synthesis');
      expect(stage.participantIds).toEqual(['Claude']);
    } finally { h.cleanup(); }
  }, 30000);

  test('legacy role labels resolve to the renamed roles', () => {
    const catalog = require('../disput/debate-prompt-catalog.js');
    expect(catalog.resolveParticipantRoleText('Meta-Синтез')).toBe('Synthes');
    expect(catalog.resolveParticipantRoleText('Критический аудит')).toBe('Critique');
    expect(catalog.resolveParticipantRoleText('Critique')).toBe('Critique');
  });

  test('double-clicking the final synthesis block opens the final synthesizer card; a single click does not', async () => {
    const h = setupCustomInheritance('Final card', { synthesis: 'Gemini' });
    try {
      const block = document.querySelector('#synthesis-stack .pipeline-synthesis-block');
      expect(block).not.toBeNull();
      block.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(document.getElementById('pipeline-block-info-modal')?.style.display).not.toBe('flex');
      block.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      const modal = h.modal();
      expect(modal.style.display).toBe('flex');
      expect(modal.querySelector('.custom-card-model').textContent).toContain('Gemini');
    } finally { h.cleanup(); }
  }, 30000);

  test('a single click on the Final badge turns the final synthesis off and on again; a double click opens the card without toggling', async () => {
    const h = setupCustomInheritance('Final toggle', { synthesis: 'GPT' });
    try {
      // The fixture has no badge; the real panel puts "Final" in the synthesis column.
      const column = document.getElementById('synthesisColumn');
      if (!column.querySelector('.round-badge')) column.insertAdjacentHTML('afterbegin', '<div class="stage-label"><span class="round-badge">Final</span></div>');
      const badge = column.querySelector('.round-badge');
      const select = document.getElementById('synthesis-flow-select');
      expect(select.querySelector('option[value=""]')).toBeNull();
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      expect(select.value).toBe('');
      expect(document.getElementById('synthesisColumn').classList.contains('pipeline-final-off')).toBe(true);
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await delay(300);
      expect(select.value).toBe('GPT');
      expect(document.getElementById('synthesisColumn').classList.contains('pipeline-final-off')).toBe(false);
      // The double click cancels the pending toggle and opens the final synthesizer card; the state stays on.
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      badge.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      badge.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await delay(300);
      expect(select.value).toBe('GPT');
      expect(h.modal().querySelector('.custom-card-model').textContent).toContain('GPT');
    } finally { h.cleanup(); }
  }, 30000);

  test('Custom ▶ model notes follow every request of their model after the request and before the limit; corrections get none', async () => {
    const h = setupCustomInheritance('Model notes');
    try {
      const general = h.openGeneral();
      expect([...general.querySelectorAll('[data-model-note]')].map((field) => field.dataset.modelNote)).toEqual(['Claude', 'GPT']);
      general.querySelector('[data-model-note="GPT"]').value = 'NOTE_GPT без вступлений';
      general.querySelector('#custom-card-save').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.debug.capturePipelineConfig().customDefaults.modelNotes).toEqual({ GPT: 'NOTE_GPT без вступлений' });
      const stored = await chrome.storage.local.get('llmComparatorPipelines');
      expect(stored.llmComparatorPipelines.pipelines['Model notes'].customDefaults.modelNotes).toEqual({ GPT: 'NOTE_GPT без вступлений' });
      h.debug.applyPipelineConfig(JSON.parse(JSON.stringify(h.debug.capturePipelineConfig())));
      expect(h.openGeneral().querySelector('[data-model-note="GPT"]').value).toBe('NOTE_GPT без вступлений');

      // The model card shows the note read-only; a personal request keeps it too.
      const card = h.openModel('GPT');
      expect(card.textContent).toContain('Особенность модели (из ▶): NOTE_GPT без вступлений');
      await h.model({ promptTemplate: 'PERSONAL_REQ {задача}\nUSE_INPUT {вход}' });
      await h.run({ retry: true });
      const sentGpt = h.starts[1].promptsByModel.GPT;
      expect(sentGpt).toContain('PERSONAL_REQ INHERITANCE TASK');
      expect(sentGpt.indexOf('PERSONAL_REQ')).toBeLessThan(sentGpt.indexOf('NOTE_GPT'));
      expect(sentGpt.indexOf('NOTE_GPT')).toBeLessThan(sentGpt.indexOf('Объём ответа'));
      expect(h.starts[0].promptsByModel.GPT).toContain('NOTE_GPT');
      expect(h.starts[0].promptsByModel.CLAUDE).not.toContain('NOTE_GPT');
      expect(h.starts[1].promptsByModel.CLAUDE).not.toContain('NOTE_GPT');
      // The retry of GPT is a correction: the note is not repeated there.
      expect(h.starts[2].promptsByModel.GPT).toContain('Твой предыдущий ответ');
      expect(h.starts[2].promptsByModel.GPT).not.toContain('NOTE_GPT');
      expect(h.starts[2].promptsByModel.GPT).toContain('Объём ответа');

      // Clearing the field removes the note; the saved ▶ has no notes any more.
      const general2 = h.openGeneral();
      general2.querySelector('[data-model-note="GPT"]').value = '';
      general2.querySelector('#custom-card-save').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(h.debug.capturePipelineConfig().customDefaults.modelNotes).toBeUndefined();
    } finally { h.cleanup(); }
  }, 30000);

  test('Custom model overrides, return to common and equal-value elision follow live ▶ changes', async () => {
    const h = setupCustomInheritance('Model inheritance');
    try {
      await h.general({ roundTask: 'COMMON_A', content: 'CONTENT_A' });
      await h.model({ task: 'OWN_TASK', content: 'OWN_CONTENT' });
      expect(h.openModel().querySelector('[data-discipline="task"] [data-action="inherit"]').hidden).toBe(false);
      await h.general({ roundTask: 'COMMON_B', content: 'CONTENT_B' });
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).toContain('OWN_TASK');
      expect(h.starts[1].promptsByModel.GPT).toContain('OWN_CONTENT');
      expect(h.starts[1].promptsByModel.CLAUDE).toContain('COMMON_B');
      expect(h.starts[1].promptsByModel.CLAUDE).toContain('CONTENT_B');
      let card = h.openModel();
      card.querySelector('[data-discipline="task"] [data-action="inherit"]').click();
      await settleCustomCard();
      card = h.modal();
      expect(card.querySelector('#custom-discipline-task').value).toBe('COMMON_B');
      expect(card.querySelector('[data-discipline="task"] [data-action="inherit"]').hidden).toBe(true);
      expect(h.debug.capturePipelineConfig().customModelSettings.r2.GPT.task).toBeUndefined();
      expect(document.activeElement).toBe(card.querySelector('textarea'));
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      expect(card.style.display).toBe('none');
      await h.model({ content: 'CONTENT_B' });
      expect(h.debug.capturePipelineConfig().customModelSettings.r2.GPT.discipline).toBeUndefined();
      await h.general({ roundTask: 'COMMON_C', content: 'CONTENT_C' });
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).toContain('COMMON_C');
      expect(h.starts[1].promptsByModel.GPT).toContain('CONTENT_C');
      card = h.openModel();
      expect(card.querySelector('#custom-card-request').value).toContain('COMMON_C');
      expect(card.querySelector('#custom-card-personal-note').textContent).toBe('');
      await h.model({ promptTemplate: 'PERSONAL_REQUEST {задача}' });
      await h.general({ roundTask: 'COMMON_D', content: 'CONTENT_D' });
      expect(h.openModel().querySelector('#custom-card-personal-note').textContent).toBe('Персональный запрос: общее задание не применяется; дисциплина применяется.');
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).toContain('PERSONAL_REQUEST INHERITANCE TASK');
      expect(h.starts[1].promptsByModel.GPT).not.toContain('COMMON_D');
      expect(h.starts[1].promptsByModel.GPT).toContain('CONTENT_D');
    } finally { h.cleanup(); }
  }, 30000);

  test('Custom ▶ persists in saved configs and export/import; templates and + keep separate session defaults', async () => {
    const h = setupCustomInheritance('Defaults saved copy');
    try {
      await h.general({ roundTask: 'PERSISTED_ROUND', content: 'PERSISTED_CONTENT' });
      const stored = (await chrome.storage.local.get('llmComparatorPipelines')).llmComparatorPipelines;
      expect(stored.pipelines['Defaults saved copy'].customDefaults.roundTask).toBe('PERSISTED_ROUND');
      const exported = JSON.parse(JSON.stringify(h.debug.buildPipelineExportPayload()));
      const imported = h.debug.normalizePipelineStore(exported);
      h.debug.clearCustomSessionForTest();
      h.debug.setPipelineStoreForTest(imported);
      h.debug.applyPipelineConfig(imported.pipelines['Defaults saved copy']);
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).toContain('PERSISTED_ROUND');
      expect(h.starts[1].promptsByModel.GPT).toContain('PERSISTED_CONTENT');
      const template = { ...h.config, customDefaults: { roundTask: 'MUST_NOT_LOAD_IN_TEMPLATE' } };
      h.debug.clearCustomSessionForTest();
      h.debug.setPipelineStoreForTest({ active: 'Custom', order: ['Custom'], pipelines: { Custom: template } });
      h.debug.applyPipelineConfig(template);
      expect(h.debug.getCustomPipelineDefaults()).toEqual({});
      await h.general({ roundTask: 'TEMPLATE_SESSION' });
      expect(h.debug.getCustomPipelineDefaults().roundTask).toBe('TEMPLATE_SESSION');
      expect(h.debug.getPipelineStoreSnapshot().pipelines.Custom.customDefaults.roundTask).toBe('MUST_NOT_LOAD_IN_TEMPLATE');
      const oldPrompt = window.prompt;
      window.prompt = jest.fn(() => 'Copy from template');
      try { document.getElementById('pipeline-save-btn').click(); await settleCustomCard(); }
      finally { window.prompt = oldPrompt; }
      expect(h.debug.getPipelineStoreSnapshot().active).toBe('Copy from template');
      expect(h.debug.getCustomPipelineDefaults().roundTask).toBe('TEMPLATE_SESSION');
      await h.run();
      expect(h.starts[1].promptsByModel.GPT).toContain('TEMPLATE_SESSION');
      h.debug.setPipelineStoreForTest({ active: 'Custom', order: ['Custom'], pipelines: { Custom: template } });
      h.debug.applyPipelineConfig(template);
      expect(h.debug.getCustomPipelineDefaults().roundTask).toBe('TEMPLATE_SESSION');
      h.debug.clearCustomSessionForTest();
      h.debug.applyPipelineConfig(template);
      expect(h.debug.resolveCustomFields().task.value).not.toContain('TEMPLATE_SESSION');
      document.getElementById('pipeline-add-btn').click();
      expect(h.debug.capturePipelineConfig().customDefaults).toEqual({});
    } finally { h.cleanup(); }
  }, 30000);

  test('Custom ▶ is read-only during a run while its contents can still be copied', async () => {
    const h = setupCustomInheritance('Read-only defaults');
    const originalSend = chrome.runtime.sendMessage.getMockImplementation();
    let release;
    let first = true;
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (first && message.type === 'START_FULLPAGE_PROCESS') { first = false; release = () => originalSend(message, callback); }
      else return originalSend(message, callback);
    });
    let running;
    try {
      running = h.run();
      for (let i = 0; i < 50 && !release; i++) await settleCustomCard();
      const card = h.openGeneral();
      expect([...card.querySelectorAll('textarea')].every((field) => field.readOnly)).toBe(true);
      expect(card.querySelector('#custom-card-save').disabled).toBe(true);
      expect(card.querySelector('[data-action="clear"]').disabled).toBe(true);
      expect(card.querySelector('[data-action="copy"]').disabled).toBe(false);
    } finally { release?.(); if (running) await running; h.cleanup(); }
  }, 30000);

  test('templates keep their names: no renaming a template and no taking a template name', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const mine = { protocol: { type: 'universal', presetId: 'CUSTOM' }, modelStacks: {} };
    debug.setPipelineStoreForTest({ pipelines: { Mine: mine }, order: ['Mine'] });
    debug.ensureDefaultPipelinePresets();
    await expect(debug.renamePipelineForTest('Test', 'My test')).resolves.toBe(false);
    await expect(debug.renamePipelineForTest('Mine', 'Polishing')).resolves.toBe(false);
    const store = debug.getPipelineStoreSnapshot();
    expect(store.pipelines.Mine).toEqual(mine);
    expect(store.pipelines.Polishing.protocol.presetId).toBe('POLISHING');
    expect(store.pipelines.Test.protocol.presetId).toBe('TEST');
  });

  test('retiring Red Team removes the built-in and preserves user-named copies', () => {
    const debug = window.__pipelineLifecycleDebug;
    const saved = { protocol: { type: 'universal', presetId: 'UNIVERSAL_RED_TEAM' }, modelStacks: { 'r1-models': { items: [{ name: 'GPT', send: true }] } } };
    debug.setPipelineStoreForTest({
      pipelines: { 'Red Team': saved, 'My review': saved },
      order: ['Red Team', 'My review'], active: 'Red Team', lastSaved: 'Red Team'
    });
    expect(debug.ensureDefaultPipelinePresets()).toBe(true);
    const store = debug.getPipelineStoreSnapshot();
    expect(store.order).toEqual(['Custom', 'Polishing', 'Delta', 'Test', 'Research', 'Architecture', 'My review']);
    expect(store.pipelines['Red Team']).toBeUndefined();
    expect(store.pipelines['My review'].modelStacks).toEqual(saved.modelStacks);
    expect(store.active).toBe('');
    expect(store.lastSaved).toBe('');
  });

  test('new empty pipeline resets an inherited round limit to the three-round default', () => {
    document.getElementById('debate-round-limit-select').value = '5';
    document.getElementById('pipeline-add-btn').click();

    expect(document.getElementById('debate-round-limit-select').value).toBe('3');
    expect(document.getElementById('round1')).not.toBeNull();
    expect(document.getElementById('round2')).not.toBeNull();
    expect(document.getElementById('round3')).not.toBeNull();
    expect(document.querySelectorAll('.stage-column[data-round]')).toHaveLength(3);
    expect(document.querySelectorAll('.model-stack .pipeline-empty-slot')).toHaveLength(3);
  });

  test('new empty pipeline starts with Claude as the final synthesizer and its selector stays enabled after model choice', () => {
    document.getElementById('pipeline-add-btn').click();

    const synthesisSelect = document.getElementById('synthesis-flow-select');
    const synthesisBlock = document.querySelector('.pipeline-synthesis-block');
    expect(window.__getDefaultSynthesizerName()).toBe('Claude');
    expect(synthesisSelect.value).toBe('Claude');
    expect(synthesisBlock.classList.contains('selected-synthesizer')).toBe(true);

    document.getElementById('llm-gpt').click();
    expect(synthesisSelect.disabled).toBe(false);
  });

  test('built-in pipeline round changes are not remembered after switching away and back', () => {
    const testPipeline = document.querySelector('.pipeline-item[data-name="Test"]');
    const research = document.querySelector('.pipeline-item[data-name="Research"]');
    testPipeline.click();
    const roundLimit = document.getElementById('debate-round-limit-select');
    roundLimit.value = '5';
    roundLimit.dispatchEvent(new Event('change', { bubbles: true }));
    research.click();
    document.querySelector('.pipeline-item[data-name="Test"]').click();

    expect(roundLimit.value).toBe('2');
  });

  test('no model is selected by default', () => {
    expect(window.PipelineRuntime.DEFAULT_MODEL_INDICES).toEqual([]);
    expect(window.PipelineRuntime.MODELS.filter((model) => model.defaultActive)).toEqual([]);
  });

  test('Universal selection keeps every selected available model', () => {
    const selectedIds = ['llm-gpt', 'llm-gemini', 'llm-claude', 'llm-grok'];
    selectedIds.forEach((id) => document.getElementById(id).click());

    expect(window.ResultsShared.getSelectedLLMs()).toEqual([
      'GPT', 'Gemini', 'Claude', 'Grok'
    ]);
    expect(document.querySelectorAll('#r1-models .pipeline-empty-slot')).toHaveLength(0);
    expect(document.querySelectorAll('#r1-models .model-block')).toHaveLength(4);
  });

  test('explicit synthesizer remains visible after an infinite-limit reload state', () => {
    const roundLimit = document.getElementById('debate-round-limit-select');
    roundLimit.value = 'infinite';
    document.getElementById('llm-claude').classList.add('active');
    document.dispatchEvent(new CustomEvent('llm-selection-change', {
      detail: { selected: ['Claude'] }
    }));
    window.setSynthesisModelFromName('Claude');
    window.syncDebateSchemeUi();

    expect(document.getElementById('synthesisColumn').hidden).toBe(false);
    expect(document.getElementById('connectorToSynthesis').hidden).toBe(false);
    expect(document.querySelector('#synthesis-stack .pipeline-synthesis-block .model-name').textContent)
      .toBe('Synthesis');
    expect(document.querySelector('#synthesis-stack .synthesis-flow-select').value).toBe('Claude');
  });

  test('the final synthesizer keeps its round blocks in model order and in the normal block design', () => {
    document.getElementById('debate-round-limit-select').value = '3';
    ['llm-gpt', 'llm-gemini', 'llm-claude', 'llm-grok'].forEach((id) => document.getElementById(id).click());
    window.setSynthesisModelFromName('Gemini');
    window.syncPipelineModelsFromSelectedLLMs({ force: true });
    const roundNames = (id) => [...document.querySelectorAll(`#${id} .model-block`)].map((block) => block.querySelector('.model-name').textContent);
    const modelOrder = ['Claude', 'GPT', 'Gemini', 'Grok'];
    ['r1-models', 'r2-models'].forEach((id) => {
      expect(roundNames(id)).toEqual(modelOrder);
      document.querySelectorAll(`#${id} .model-block`).forEach((block) => {
        expect(block.classList.contains('selected-synthesizer')).toBe(false);
        expect(block.classList.contains('pipeline-final-synthesizer')).toBe(false);
      });
    });
    const synthesisBlock = document.querySelector('#synthesis-stack .pipeline-synthesis-block');
    expect(synthesisBlock.querySelector('.model-name').textContent).toBe('Synthesis');
    expect(synthesisBlock.classList.contains('selected-synthesizer')).toBe(true);
    expect(synthesisBlock.classList.contains('pipeline-final-synthesizer')).toBe(false);
  });

  test('the final synthesis block is not active without selected models, and is active once models are selected', () => {
    const synthesisBlock = () => document.querySelector('#synthesis-stack .pipeline-synthesis-block');
    document.getElementById('pipeline-add-btn').click();
    expect(synthesisBlock().classList.contains('selected-synthesizer')).toBe(true);
    expect(synthesisBlock().classList.contains('inactive')).toBe(true);
    document.getElementById('llm-gpt').click();
    expect(synthesisBlock().classList.contains('inactive')).toBe(false);
    document.getElementById('llm-gpt').click();
    expect(synthesisBlock().classList.contains('inactive')).toBe(true);
  });

  test('terminal synthesis card aligns to the visible model-stack centre', () => {
    document.getElementById('debate-round-limit-select').value = '3';
    window.syncDebateSchemeUi();
    document.getElementById('synthesisColumn').hidden = false;
    document.getElementById('connectorToSynthesis').hidden = false;
    const modelStacks = Array.from(document.querySelectorAll('.model-stack'))
      .filter((stack) => stack.id !== 'synthesis-stack');
    const referenceStack = modelStacks[modelStacks.length - 1];
    const synthesisStack = document.getElementById('synthesis-stack');
    document.getElementById('synthesisColumn').style.setProperty('--pipeline-terminal-offset', '0px');
    const makeRect = (top, height) => ({ top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON() { return this; } });
    Object.defineProperty(referenceStack, 'getBoundingClientRect', { configurable: true, value: () => makeRect(20, 180) });
    Object.defineProperty(synthesisStack, 'getBoundingClientRect', { configurable: true, value: () => makeRect(60, 60) });

    const layoutResult = window.__pipelineLifecycleDebug.updatePipelineLayout();

    expect(layoutResult).toMatchObject({
      aligned: true,
      referenceId: referenceStack.id,
      offsets: { synthesisColumn: 20 }
    });
    expect(document.getElementById('synthesisColumn').style.getPropertyValue('--pipeline-terminal-offset')).toBe('20px');
  });


  test('pipeline R1 mirrors selected top models before run when R1 is still default', () => {
    document.getElementById('pipeline-panel').insertAdjacentHTML('beforeend', `
      <div class="model-stack" id="r2-models">
        <div class="model-block">
          <span class="model-name">GPT</span>
          <input type="checkbox" class="model-input-checkbox" checked>
          <input type="checkbox" class="model-send-checkbox" checked>
        </div>
        <div class="model-block">
          <span class="model-name">Claude</span>
          <input type="checkbox" class="model-input-checkbox" checked>
          <input type="checkbox" class="model-send-checkbox" checked>
        </div>
        <div class="model-block">
          <span class="model-name">Le Chat</span>
          <input type="checkbox" class="model-input-checkbox">
          <input type="checkbox" class="model-send-checkbox">
        </div>
        <div class="model-block">
          <span class="model-name">Perplexity</span>
          <input type="checkbox" class="model-input-checkbox">
          <input type="checkbox" class="model-send-checkbox">
        </div>
      </div>
    `);
    const blocks = Array.from(document.querySelectorAll('#r1-models .model-block'));
    blocks.forEach((block) => {
      const name = block.querySelector('.model-name')?.textContent?.trim();
      const isDefault = ['Claude', 'GPT', 'Gemini'].includes(name);
      if (block.querySelector('.model-input-checkbox')) block.querySelector('.model-input-checkbox').checked = isDefault;
      if (block.querySelector('.model-send-checkbox')) block.querySelector('.model-send-checkbox').checked = isDefault;
    });

    document.querySelectorAll('.llm-button').forEach((button) => {
      button.classList.toggle('active', button.id === 'llm-lechat' || button.id === 'llm-perplexity');
    });
    document.dispatchEvent(new CustomEvent('llm-selection-change', {
      detail: { selected: ['Le Chat', 'Perplexity'] }
    }));

    const snapshot = window.__pipelineLifecycleDebug.buildPipelineRuntimeSnapshot();

    expect(snapshot.rounds[0].inputModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[0].sendModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[0].sendModels).not.toEqual(expect.arrayContaining(['Claude', 'GPT', 'Gemini']));
    expect(snapshot.rounds[1].inputModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[1].sendModels).toEqual(['Le Chat', 'Perplexity']);
    expect(snapshot.rounds[1].sendModels).not.toEqual(expect.arrayContaining(['Claude', 'GPT', 'Gemini']));
  });

  test('pipeline HTML entrypoints expose mount points instead of hard-coded model blocks', () => {
    ['pipeline_panel.html', 'result_new.html'].forEach((fileName) => {
      const html = fs.readFileSync(path.join(__dirname, '..', fileName), 'utf8');
      expect(html).toContain('pipeline/pipeline-runtime.js');
      expect(html).toContain('data-render="pipeline-model-stack-r1"');
      expect(html).toContain('data-render="pipeline-model-stack-r2"');
      expect(html).not.toContain('data-render="pipeline-output-stack"');
      expect(html).not.toContain('id="outputColumn"');
      expect(html).not.toContain('id="connectorToOutput"');
      expect(html).not.toContain('class="model-block');
      expect(html).not.toContain('class="output-block');
    });
  });

  test('pipeline moderator header has no status indicator and pending zone label CSS is removed', () => {
    const panelHtml = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    const css = readResolvedCss();

    expect(panelHtml).not.toContain('id="mod-status-indicator"');
    expect(css).not.toContain('.debate-model-card.first-pending-zone-card::before');
    expect(css).not.toContain('На утверждение');
  });

  test('a folded moderator paste remains complete in the dispatch text', () => {
    const input = document.getElementById('modTa');
    const text = 'Complete pasted moderator message\n'.repeat(130);
    input.value = 'before REPLACE after';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.setSelectionRange(7, 14);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (type) => type === 'text/plain' ? text : '', files: [] } });
    input.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(input.value).toBe('before  after');
    expect(window.__pipelineLifecycleDebug.getModeratorDispatchText()).toBe(`before ${text} after`);
    document.querySelector('.pasted-text-remove').click();
    expect(window.__pipelineLifecycleDebug.getModeratorDispatchText()).toBe('before  after');
  });


  test('the page boots and renders model blocks with a non-empty template header', () => {
    // The template header is non-empty, as on the real page: boot must not ask the store helpers before they exist.
    expect(document.querySelectorAll('.model-block').length).toBeGreaterThan(0);
  });

});

describe('Final synthesis state after a page reload', () => {
  test('an explicit Final OFF on the unsaved pipeline survives a reload and the block is not shown active', async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript();
    document.getElementById('pipeline-add-btn').click();
    document.getElementById('llm-gpt').click();
    expect(window.setSynthesisModelFromName('')).toBe(true);
    expect(document.getElementById('synthesisColumn').classList.contains('pipeline-final-off')).toBe(true);
    await delay(0);
    const { llmComparatorPipelines: saved } = await chrome.storage.local.get('llmComparatorPipelines');
    expect(saved.draftPlans.unsaved.plannedStages.some((stage) => stage.plannedStageId === 'planned-final-synthesis')).toBe(false);

    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript(saved);
    const column = document.getElementById('synthesisColumn');
    const block = document.querySelector('#synthesis-stack .pipeline-synthesis-block');
    expect(column.classList.contains('pipeline-final-off')).toBe(true);
    expect(document.getElementById('synthesis-flow-select').value).toBe('');
    expect(block.classList.contains('selected-synthesizer')).toBe(false);
    expect(block.classList.contains('pipeline-final-synthesizer')).toBe(false);
  }, 30000);
});

describe('Pipeline canvas run state (engine-derived)', () => {
  const RUN_CLASSES = '.pipeline-run-pending,.pipeline-run-running,.pipeline-run-done,.pipeline-link-pending,.pipeline-link-running,.pipeline-link-done';

  beforeAll(async () => {
    renderDebateDom();
    document.body.classList.add('pipeline-page');
    await loadResultsScript();
    // Round 1 and 2 get a model each; round 3 is added so the link into a pending stage exists.
    document.getElementById('r1-models').innerHTML = '<div class="model-block active"><span class="model-name">GPT</span></div>';
    document.getElementById('r2-models').innerHTML = '<div class="model-block active"><span class="model-name">Claude</span></div>';
    document.getElementById('round2').insertAdjacentHTML('afterend', `
      <div class="connector-group" id="grp-r2-r3"><svg class="connector-svg" id="svg-r2-r3"></svg></div>
      <div class="stage-column" id="round3" data-round="3"><div class="model-stack" id="r3-models"><div class="model-block active"><span class="model-name">GPT</span></div></div></div>`);
  });

  test('stage 1 done, stage 2 running, stage 3 pending: blocks and links carry the run classes', () => {
    window.__syncPipelineRunStateVisuals({
      lifecycle: 'RUNNING',
      stages: [
        { plannedStageId: 'canvas-r1', status: 'completed' },
        { plannedStageId: 'canvas-r2', status: 'running' }
      ]
    });
    const gptR1 = document.querySelector('#round1 .model-block');
    const claudeR2 = document.querySelector('#round2 .model-block');
    const gptR3 = document.querySelector('#round3 .model-block');
    expect(gptR1.classList.contains('pipeline-run-done')).toBe(true);
    expect(claudeR2.classList.contains('pipeline-run-running')).toBe(true);
    expect(gptR3.classList.contains('pipeline-run-pending')).toBe(true);
    // The link into round 2 is the one running now; the link into round 3 waits.
    expect(document.getElementById('svg-r1-r2').closest('.connector-group').classList.contains('pipeline-link-running')).toBe(true);
    expect(document.getElementById('svg-r2-r3').closest('.connector-group').classList.contains('pipeline-link-pending')).toBe(true);
  });

  test('a finished run keeps done blocks and done links; a stopped run never shows a stage as running', () => {
    window.__syncPipelineRunStateVisuals({
      lifecycle: 'COMPLETED',
      stages: [
        { plannedStageId: 'canvas-r1', status: 'completed' },
        { plannedStageId: 'canvas-r2', status: 'completed' }
      ]
    });
    expect(document.querySelector('#round2 .model-block').classList.contains('pipeline-run-done')).toBe(true);
    expect(document.getElementById('svg-r1-r2').closest('.connector-group').classList.contains('pipeline-link-done')).toBe(true);
    expect(document.querySelector('#round3 .model-block').classList.contains('pipeline-run-pending')).toBe(true);

    window.__syncPipelineRunStateVisuals({
      lifecycle: 'CANCELLED',
      stages: [{ plannedStageId: 'canvas-r2', status: 'running' }]
    });
    expect(document.querySelector('#round2 .model-block').classList.contains('pipeline-run-running')).toBe(false);
    expect(document.querySelector('#round2 .model-block').classList.contains('pipeline-run-pending')).toBe(true);
  });

  test('before the run (IDLE, CREATED) every block and link is pending (gray)', () => {
    window.__syncPipelineRunStateVisuals({
      lifecycle: 'RUNNING',
      stages: [{ plannedStageId: 'canvas-r1', status: 'running' }]
    });
    expect(document.querySelectorAll('.pipeline-run-running').length).toBeGreaterThan(0);
    ['IDLE', 'CREATED'].forEach((lifecycle) => {
      window.__syncPipelineRunStateVisuals({ lifecycle, stages: [] });
      expect(document.querySelectorAll('.pipeline-run-running, .pipeline-run-done, .pipeline-link-running, .pipeline-link-done').length).toBe(0);
      expect(document.querySelectorAll('.pipeline-run-pending').length).toBeGreaterThan(0);
      expect(document.querySelectorAll('.pipeline-link-pending').length).toBeGreaterThan(0);
    });
  });

  test('no synthesis green rule can override the run states (synthesis blocks are gray before the run)', () => {
    const css = fs.readFileSync(path.join(__dirname, '..', 'styles', 'pipeline.css'), 'utf8');
    expect(css).not.toContain('.pipeline-synthesis-block.selected-synthesizer:not(.inactive)');
    expect(css).toContain('.pipeline-flow .model-block.pipeline-run-pending {');
  });
});
