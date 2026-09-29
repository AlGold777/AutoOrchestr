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
        <button class="stb" data-clear-highlight="1" aria-label="Remove highlight">No colour</button>
        <button class="stb col" data-color="#fde68a" aria-label="Yellow highlight">Yellow</button>
        <button class="stb col" data-color="#bbf7d0" aria-label="Green highlight">Green</button>
        <button class="stb col" data-color="#bfdbfe" aria-label="Blue highlight">Blue</button>
        <button class="stb" data-cmd="bold" aria-label="Bold">Bold</button>
        <button class="stb" data-cmd="italic" aria-label="Italic">Italic</button>
        <button class="stb" data-fav="1" aria-label="Add selected fragment to favorites">Favorite</button>
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
        <span id="currentPipelineName" class="pipeline-name"></span>
        <button type="button" id="pipeline-add-round-btn">+</button>
        <button type="button" id="pipeline-add-btn">+</button>
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

async function loadResultsScript() {
  installChromeStorageMock();
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
  ['boot-utils', 'dom-utils', 'attachments', 'tooltips', 'debate-ui', 'debate-transport', 'debate-controller', 'debate-renderer', 'debate-sessions-store', 'debate-export', 'debate-plan-view-model', 'debate-telemetry-view'].forEach((mod) => { window.eval(fs.readFileSync(path.join(__dirname, '..', 'results', `${mod}.js`), 'utf8')); });
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

  test('pipeline waiter ignores partial and wrong-batch responses until terminal response arrives', async () => {
    const debug = window.__pipelineLifecycleDebug;
    const context = {
      pipelineRunId: 'run-1',
      pipelineRoundId: 'r1',
      pipelineBatchId: 'run-1:r1:g0'
    };
    let settled = false;
    const waitPromise = debug.pipelineWaiter
      .waitForModels(['GPT'], { timeoutMs: 200, context })
      .then((result) => {
        settled = true;
        return result;
      });

    expect(debug.pipelineWaiter.handlePartial({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'first chunk',
      metadata: { ...context, status: 'GENERATING' }
    })).toBe(true);
    await delay(20);
    expect(settled).toBe(false);

    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'old final',
      metadata: { ...context, pipelineBatchId: 'old-run:r1:g0', status: 'SUCCESS' }
    })).toBe(false);
    await delay(20);
    expect(settled).toBe(false);

    expect(debug.pipelineWaiter.handleFinal({
      type: 'LLM_PARTIAL_RESPONSE',
      llmName: 'GPT',
      answer: 'correct final',
      metadata: { ...context, status: 'SUCCESS' }
    })).toBe(true);

    await expect(waitPromise).resolves.toMatchObject({
      responses: { GPT: 'correct final' },
      missing: [],
      timedOut: false
    });
    expect(settled).toBe(true);
  });

  test('pipeline wait timeout is extended for slow Qwen batches only', () => {
    const debug = window.__pipelineLifecycleDebug;

    expect(debug.resolvePipelineWaitTimeoutMs(['GPT'], 240000)).toBe(240000);
    expect(debug.resolvePipelineWaitTimeoutMs(['GPT', 'Qwen'], 240000)).toBe(600000);
    expect(debug.resolvePipelineWaitTimeoutMs(['Qwen'], 900000)).toBe(900000);
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
    expect(card.querySelector('.post-terminal-answer-revision summary').textContent).toContain('Ответ обновлён после завершения');
    expect(card.querySelector('.post-terminal-answer-revision summary').textContent).toContain('late_partial_response');
    expect(card.querySelector('.post-terminal-answer-revision-body').textContent).toContain('text appended');
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

    const artifact = debug.collectDebateArtifact();
    const session = artifact.sessions.find((item) => item.sessionId === 'restore-1');
    expect(session.turns).toEqual(expect.arrayContaining([
      expect.objectContaining({ turnId: 'turn-restore-gpt', terminalStatus: 'SUCCESS', status: 'approved' })
    ]));
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
    expect(names).toEqual(['Universal', 'Research', 'Red Team']);
    expect(document.querySelectorAll('#pipelineItems .pipeline-item-delete')).toHaveLength(0);
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

  test('new empty pipeline clears synthesizer and enables its selector after model choice', () => {
    document.getElementById('pipeline-add-btn').click();

    const synthesisSelect = document.getElementById('synthesis-flow-select');
    const synthesisBlock = document.querySelector('.pipeline-synthesis-block');
    expect(synthesisSelect.value).toBe('');
    expect(synthesisBlock.classList.contains('selected-synthesizer')).toBe(false);
    expect(synthesisBlock.classList.contains('inactive')).toBe(true);

    document.getElementById('llm-gpt').click();
    expect(synthesisSelect.disabled).toBe(false);
  });

  test('built-in pipeline round changes are not remembered after switching away and back', () => {
    const universal = document.querySelector('.pipeline-item[data-name="Universal"]');
    const research = document.querySelector('.pipeline-item[data-name="Research"]');
    universal.click();
    const roundLimit = document.getElementById('debate-round-limit-select');
    roundLimit.value = '5';
    roundLimit.dispatchEvent(new Event('change', { bubbles: true }));
    research.click();
    document.querySelector('.pipeline-item[data-name="Universal"]').click();

    expect(roundLimit.value).toBe('3');
  });

  test('Universal runtime default activates exactly two models', () => {
    expect(window.PipelineRuntime.DEFAULT_MODEL_INDICES).toEqual([0, 1]);
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
      .toBe('Claude');
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


});
