// The Local LLM tab of the telemetry window: the system instruction, the attached files, and the log of what went wrong.
// All of it is kept by LocalModel (chrome.storage.local) and also reaches the hints of the owner window. Texts are written with textContent only.
(function initLocalLlmTab(root) {
  'use strict';

  const MAX_FILES = 10;
  const MAX_FILE_BYTES = 200 * 1024;
  const TEXT_NAME = /\.(txt|md|markdown|json|csv|tsv|log|ya?ml|xml|html?|js|ts|py|css|sql)$/i;

  const el = (doc, tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };
  const card = (doc, title) => {
    const box = el(doc, 'article', 'devtools-card local-llm-card');
    const header = el(doc, 'div', 'devtools-card-header');
    header.append(el(doc, 'h2', '', title));
    const body = el(doc, 'div', 'devtools-card-body');
    box.append(header, body);
    return { box, header, body };
  };
  const clockOf = (at) => new Date(at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const isText = (file) => String(file.type || '').startsWith('text/') || TEXT_NAME.test(String(file.name || ''));

  function mount(panel, { api = root.LocalModel, doc = root.document, areaEvents = root.chrome?.storage?.onChanged } = {}) {
    if (!panel || !api || panel.dataset.localLlmMounted) return null;
    panel.dataset.localLlmMounted = '1';
    const grid = el(doc, 'div', 'local-llm-grid');
    panel.append(grid);

    // 1. System instruction.
    const system = card(doc, 'Системная инструкция');
    const systemArea = el(doc, 'textarea', 'local-llm-system');
    systemArea.rows = 8;
    systemArea.spellcheck = false;
    systemArea.placeholder = 'Что модель должна учитывать всегда';
    systemArea.setAttribute('aria-label', 'Системная инструкция');
    const systemStatus = el(doc, 'span', 'devtools-meta local-llm-status');
    system.header.append(systemStatus);
    system.body.append(systemArea);
    let systemTimer = null;
    const saveSystem = () => api.updateState(() => ({ system: systemArea.value })).then(() => { systemStatus.textContent = 'Сохранено'; });
    systemArea.addEventListener('input', () => {
      systemStatus.textContent = '';
      clearTimeout(systemTimer);
      systemTimer = setTimeout(saveSystem, 400);
    });

    // 2. Files.
    const files = card(doc, 'Файлы');
    const zone = el(doc, 'div', 'local-llm-drop', 'Перетащите текстовые файлы сюда');
    zone.setAttribute('role', 'region');
    zone.setAttribute('aria-label', 'Перетащите файлы');
    const fileList = el(doc, 'ul', 'local-llm-files');
    files.body.append(zone, fileList);
    const renderFiles = (items) => {
      fileList.replaceChildren(...items.map((file) => {
        const row = el(doc, 'li', 'local-llm-file');
        const remove = el(doc, 'button', 'diag-icon-btn local-llm-file-remove', '×');
        remove.type = 'button';
        remove.title = 'Убрать файл';
        remove.setAttribute('aria-label', `Убрать файл ${file.name}`);
        remove.addEventListener('click', () => api.updateState((state) => ({ files: state.files.filter((item) => item.name !== file.name) })));
        row.append(el(doc, 'span', 'local-llm-file-name', file.name), remove);
        return row;
      }));
    };
    const addFiles = async (list) => {
      const accepted = [];
      for (const file of Array.from(list || [])) {
        if (!isText(file)) { await api.addLog('file_rejected', `${file.name}: не текстовый файл`); continue; }
        if (file.size > MAX_FILE_BYTES) { await api.addLog('file_rejected', `${file.name}: больше 200 КБ`); continue; }
        accepted.push({ name: String(file.name), text: await file.text() });
      }
      if (!accepted.length) return;
      await api.updateState((state) => {
        const names = new Set(accepted.map((file) => file.name));
        return { files: [...state.files.filter((file) => !names.has(file.name)), ...accepted].slice(-MAX_FILES) };
      });
    };
    ['dragenter', 'dragover'].forEach((type) => zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add('is-over'); }));
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (event) => {
      event.preventDefault();
      zone.classList.remove('is-over');
      addFiles(event.dataTransfer?.files);
    });

    // 3. Log.
    const log = card(doc, 'Log');
    const clearLog = el(doc, 'button', 'devtools-pill-btn local-llm-clear', 'Очистить');
    clearLog.type = 'button';
    clearLog.addEventListener('click', () => api.updateState(() => ({ log: [] })));
    const saveShots = el(doc, 'button', 'devtools-pill-btn local-llm-shots', 'Снимки');
    saveShots.type = 'button';
    saveShots.title = 'Скачать снимки вкладок, на которых застрял прогон';
    saveShots.addEventListener('click', async () => {
      const state = await api.loadState();
      const url = root.URL.createObjectURL(new Blob([JSON.stringify(state.observations || [], null, 1)], { type: 'application/json' }));
      const link = el(doc, 'a');
      link.href = url;
      link.download = 'local-llm-observations.json';
      link.click();
      root.URL.revokeObjectURL(url);
    });
    log.header.append(saveShots, clearLog);
    const logList = el(doc, 'ul', 'local-llm-log');
    log.body.append(logList);
    const renderLog = (items) => {
      if (!items.length) { logList.replaceChildren(el(doc, 'li', 'diag-empty', 'Сбоев нет')); return; }
      logList.replaceChildren(...items.map((entry) => {
        const row = el(doc, 'li', 'local-llm-log-row');
        row.append(el(doc, 'time', 'local-llm-log-time', clockOf(entry.at)), el(doc, 'strong', '', api.LOG_LABELS[entry.kind] || entry.kind));
        if (entry.detail) row.append(el(doc, 'span', 'local-llm-log-detail', entry.detail));
        return row;
      }));
    };

    grid.append(system.box, files.box, log.box);

    const render = (state, { withSystem = false } = {}) => {
      if (withSystem) systemArea.value = state.system || '';
      renderFiles(state.files || []);
      renderLog(state.log || []);
    };
    const ready = api.loadState().then((state) => render(state, { withSystem: true }));
    areaEvents?.addListener?.((changes, area) => {
      if (area === 'local' && changes[api.STATE_KEY]) render({ files: [], log: [], ...changes[api.STATE_KEY].newValue });
    });
    return { ready, addFiles, saveSystem };
  }

  const api = Object.freeze({ mount });
  root.LocalLlmTab = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document) {
    const start = () => mount(root.document.getElementById('local-llm-tabpanel'));
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  }
})(typeof window !== 'undefined' ? window : globalThis);
