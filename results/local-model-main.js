// Functions of the local model on the main page (result_new.html). Observation only: the page reads the tabs of the models of the
// current request and writes to the Log and to a line in the card. It presses nothing; sending and acceptance of answers do not depend on it.
//  - main_stall_watch: a tab with no progress is looked at once (createStallWatch), until the model has a final answer.
//  - main_failure_look: a model that ended with an error, a timeout or an empty answer: its tab is looked at once, the line is in the card.
//  - main_answer_label: a final answer with text gets one label per model and request (refusal, cut off, not to the question); the quote is checked in the answer.
(function initLocalModelMain(root) {
  'use strict';

  const create = ({ api = root.LocalModel, doc = root.document, contract = root.LLMStatusContract } = {}) => {
    if (!api || !doc) return null;
    const current = new Set(); // models of the current request of the page
    const looked = new Set(); // models whose tab was already looked at for this request
    const labelled = new Set(); // models whose answer was already labelled for this request
    let prompt = '';
    let serial = 0; // grows with every new request and every stop: a late result of an older one is dropped
    let tabs = {};
    let watch = null;
    const onPage = () => !doc.body?.classList.contains('pipeline-page');
    const status = (value) => String(value || '').trim().toUpperCase();
    const isFailure = (value) => Boolean(contract?.isFailureStatus(value)) && Boolean(contract?.isTerminalStatus(value));
    const isFinal = (value) => Boolean(contract?.isTerminalStatus(value));
    const panelsOf = (name) => Array.from(doc.querySelectorAll('.llm-panel .status-indicator'))
      .filter((item) => item.dataset.llmName === name)
      .map((item) => item.closest('.llm-header') || item.parentElement)
      .filter(Boolean);

    const setLine = (name, text) => {
      panelsOf(name).forEach((header) => {
        let node = header.querySelector('.local-model-look');
        if (!text) { node?.remove(); return; }
        if (!node) {
          node = doc.createElement('span');
          node.className = 'local-model-look';
          const cluster = header.querySelector('.status-control-cluster');
          if (cluster) cluster.after(node); else header.append(node);
        }
        node.textContent = text;
        node.title = text;
      });
    };
    const clearLine = (name) => { looked.delete(name); labelled.delete(name); setLine(name, ''); };

    const stopWatch = () => { watch?.stop(); watch = null; };
    const finish = (name) => {
      if (!watch) return;
      watch.note({ participant: name, state: 'done' });
      if (!watch.waitingCount()) stopWatch();
    };

    // A new request of the page: the old lines go away, the watch covers the models of this request only.
    const begin = (names, text = '') => {
      if (!onPage()) return;
      serial += 1;
      prompt = String(text ?? '');
      stopWatch();
      // All lines and marks of the earlier requests go, also after a Stop that already emptied the current set.
      Array.from(current).forEach(clearLine);
      doc.querySelectorAll('.local-model-look').forEach((node) => node.remove());
      looked.clear();
      labelled.clear();
      current.clear();
      (names || []).forEach((name) => { if (name) current.add(String(name)); });
      if (!current.size || !api.enabled?.()) return;
      watch = api.createStallWatch({ tabOf: (name) => tabs[name], enabled: () => api.feature('main_stall_watch') });
      current.forEach((name) => watch.note({ participant: name }));
      watch.start();
    };
    // Stop or the end of the request: a late status of its models looks at nothing.
    const stop = () => { serial += 1; stopWatch(); current.clear(); };

    const look = async (name, reason) => {
      if (!onPage() || !current.has(name) || looked.has(name) || !api.feature('main_failure_look')) return;
      const tabId = tabs[name];
      if (!tabId) return;
      looked.add(name);
      const mine = serial;
      try {
        const result = await api.observeTab({ tabId, participant: name, reason });
        // The card may have been cleared or a new request started while the model was looking.
        if (result && mine === serial && current.has(name) && looked.has(name)) setLine(name, api.observationLine(name, result));
      } catch (_) { /* observation never breaks the page */ }
    };

    // A status of a model that the page applied.
    const noteStatus = (name, value) => {
      if (!onPage() || !current.has(name)) return;
      const next = status(value);
      if (isFinal(next)) finish(name);
      if (isFailure(next)) void look(name, `статус ${next}`);
    };
    // A final answer: without text the tab is looked at, with text the answer is labelled.
    const label = async (name, text) => {
      if (labelled.has(name) || !api.feature('main_answer_label')) return;
      labelled.add(name);
      const mine = serial;
      try {
        const result = await api.labelAnswer({ prompt, answer: text, participant: name });
        // The card may have been cleared while the model was reading the answer.
        if (result && mine === serial && current.has(name) && labelled.has(name)) setLine(name, api.answerLabelLine(name, result));
      } catch (_) { /* the label never breaks the page */ }
    };
    const noteAnswer = (name, text) => {
      if (!onPage() || !current.has(name)) return;
      finish(name);
      if (!String(text ?? '').trim()) void look(name, 'пустой ответ');
      else void label(name, String(text));
    };
    // The tabs of the models come from the global state broadcast of the background part.
    const setTabs = (state) => {
      const next = { ...(state?.tabs?.map || {}) };
      Object.entries(state?.llms || {}).forEach(([name, entry]) => { if (entry?.tabId) next[name] = entry.tabId; });
      tabs = next;
    };

    // The card is cleared: its line goes away with its answer.
    doc.addEventListener('click', (event) => {
      if (!onPage()) return;
      if (event.target.closest?.('#clear-all-btn')) { Array.from(current).forEach(clearLine); doc.querySelectorAll('.local-model-look').forEach((node) => node.remove()); return; }
      const button = event.target.closest?.('.panel-clear-response-btn');
      const indicator = button?.closest('.llm-panel')?.querySelector('.status-indicator');
      if (indicator?.dataset.llmName) clearLine(indicator.dataset.llmName);
    });

    // The hooks sit in the paths of the page that show answers and send requests: an error here never reaches them.
    const safe = (fn) => (...args) => { try { return fn(...args); } catch (_) { return undefined; } };
    return { begin: safe(begin), stop: safe(stop), noteStatus: safe(noteStatus), noteAnswer: safe(noteAnswer), setTabs: safe(setTabs), setLine, active: () => Boolean(watch) };
  };

  const api = Object.freeze({ create });
  root.LocalModelMainFactory = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.LocalModel && root.document.getElementById('local-model-modal')?.dataset.page === 'main') {
    root.LocalModelMain = create();
  }
})(typeof window !== 'undefined' ? window : globalThis);
