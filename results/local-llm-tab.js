// The Local LLM tab of the telemetry window: the system instruction, the attached files, the log of what went wrong, and a chat.
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
    log.header.append(clearLog);
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

    // 4. Chat.
    const talk = card(doc, 'Чат с моделью');
    const clearChat = el(doc, 'button', 'devtools-pill-btn local-llm-clear', 'Очистить');
    clearChat.type = 'button';
    clearChat.addEventListener('click', () => api.updateState(() => ({ chat: [] })));
    talk.header.append(el(doc, 'span', 'devtools-meta', api.MODEL), clearChat);
    const turns = el(doc, 'div', 'local-llm-chat');
    const chatError = el(doc, 'p', 'local-llm-chat-error');
    chatError.hidden = true;
    const form = el(doc, 'div', 'local-llm-chat-form');
    const input = el(doc, 'textarea', 'local-llm-chat-input');
    input.rows = 2;
    input.placeholder = 'Сообщение модели. Ваши сообщения учитываются и в подсказках';
    input.setAttribute('aria-label', 'Сообщение модели');
    const send = el(doc, 'button', 'devtools-pill-btn local-llm-send', 'Отправить');
    send.type = 'button';
    form.append(input, send);
    talk.body.append(turns, chatError, form);
    const renderChat = (items) => {
      turns.replaceChildren(...items.map((turn) => el(doc, 'div', `local-llm-turn is-${turn.role === 'user' ? 'user' : 'model'}`, turn.content)));
      turns.scrollTop = turns.scrollHeight;
    };
    let busy = false;
    const sendMessage = async () => {
      const text = input.value.trim();
      if (!text || busy) return;
      busy = true;
      send.disabled = true;
      chatError.hidden = true;
      input.value = '';
      const state = await api.updateState((current) => ({ chat: [...current.chat, { role: 'user', content: text, at: Date.now() }] }));
      const reply = await api.chat(state.chat, { context: api.contextOf(state) });
      if (reply.ok) await api.updateState((current) => ({ chat: [...current.chat, { role: 'assistant', content: reply.text, at: Date.now() }] }));
      else if (reply.error) { chatError.textContent = reply.error; chatError.hidden = false; }
      busy = false;
      send.disabled = false;
    };
    send.addEventListener('click', sendMessage);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(); }
    });

    grid.append(system.box, files.box, log.box, talk.box);

    const render = (state, { withSystem = false } = {}) => {
      if (withSystem) systemArea.value = state.system || '';
      renderFiles(state.files || []);
      renderLog(state.log || []);
      renderChat(state.chat || []);
    };
    const ready = api.loadState().then((state) => render(state, { withSystem: true }));
    areaEvents?.addListener?.((changes, area) => {
      if (area === 'local' && changes[api.STATE_KEY]) render({ files: [], log: [], chat: [], ...changes[api.STATE_KEY].newValue });
    });
    return { ready, addFiles, sendMessage, saveSystem };
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
