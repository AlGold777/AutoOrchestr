// Automation Lab — page controller (layout of automation_prototype_v2.2.3.html).
// Left/right columns: per-model feeds (what was sent, what came back — answers shown cleaned,
// never with transport frames). Center: the Automation feed with stage plan, owner questions,
// commits and diagnoses. Every view is re-rendered from persisted state; model and user text is
// rendered via textContent only.
(function initAutomationLab(root) {
  'use strict';

  const MODELS = ['GPT', 'Claude', 'Gemini', 'Grok', 'Qwen', 'DeepSeek', 'Le Chat', 'Perplexity', 'Z.ai', 'Kimi'];
  const DEFAULT_MODELS = ['Claude', 'GPT', 'Gemini'];
  const MAX_MODELS = 4;
  const STATE_LABELS = {
    READY: ['Готов к запуску', 'info'],
    RUNNING: ['Выполняется', 'info'],
    PAUSED: ['Пауза — нажмите «Продолжить»', 'warn'],
    WAITING_FOR_SELECTION: ['Ждёт вашего решения', 'warn'],
    STAGE_FAILED: ['Стадия не прошла', 'err'],
    PILOT_COMPLETE: ['Стадии 1–5 завершены', 'ok']
  };
  const CODE_LABELS = { IDEA: 'Идея', DPL: 'Decision Policy', UNK: 'Неизвестные', ASM: 'Допущения', PRP: 'Предложения', RSK: 'Риски', PD: 'Решения', QST: 'Вопросы владельцу', QANS: 'Ответы', AEV: 'Акты владельца', PCON: 'Концепция продукта', FND: 'Находки ревью' };

  const $ = (id) => document.getElementById(id);
  function h(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([key, value]) => {
      if (value === undefined || value === null || value === false) return;
      if (key === 'class') node.className = value;
      else if (key === 'style') node.setAttribute('style', value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    children.flat(Infinity).forEach((child) => {
      if (child === undefined || child === null || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }
  const chip = (text, tone = '') => h('span', { class: `chip ${tone}` }, text);
  const time = (at) => (at ? new Date(at).toLocaleTimeString() : '');
  const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`);
  const pct = (value) => (value == null || Number.isNaN(value) ? '—' : `${Math.round(value * 100)}%`);
  const statusTone = (status) => ({ ACTIVE: 'ok', CLOSED: 'ok', ANSWERED: 'ok', COMPILED: 'ok', RECORDED: 'ok', COMMITTED: 'ok', ACCEPTED: 'ok', OPEN: 'warn', READY: 'warn', NEEDS_EVIDENCE: 'warn', DRAFT: 'warn', UNVERIFIED: 'warn', PROPOSED: 'info', RUNNING: 'info', PENDING: 'info', FAILED: 'err', REJECTED: 'err' }[status] || '');

  function readPref(key, fallback) {
    try { const value = localStorage.getItem(key); return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* preferences are optional */ }
  }
  function toast(text, ms = 4000) {
    const node = $('toast');
    node.textContent = text;
    node.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { node.hidden = true; }, ms);
  }

  const ui = {
    spec: null,
    engine: null,
    currentId: null,
    state: null,
    draftModels: readPref('automationLab.models', DEFAULT_MODELS).filter((m) => MODELS.includes(m)).slice(0, MAX_MODELS),
    progress: new Map(),
    colTab: { left: null, right: null },
    modalTab: 'results',
    renderTimer: null
  };

  // ---- transport routing: each dispatch carries the executing project's own mode ----------
  let simulator = null;
  let chromeTransport = null;
  const routerTransport = {
    dispatch: (args) => ((args.mode === 'simulator' || !chromeTransport) ? simulator : chromeTransport).dispatch(args),
    cancel: async () => { await simulator?.cancel(); await chromeTransport?.cancel(); }
  };

  function scheduleRender(delay = 80) {
    clearTimeout(ui.renderTimer);
    ui.renderTimer = setTimeout(() => { render().catch((error) => console.error('[AutomationLab] render failed', error)); }, delay);
  }

  // ---- boot ------------------------------------------------------------------------------
  async function boot() {
    $('simulatorToggle').checked = readPref('automationLab.simulator', !root.chrome?.runtime?.id);
    $('simulatorToggle').addEventListener('change', (event) => writePref('automationLab.simulator', event.target.checked));
    renderModelNav();
    try {
      ui.spec = await root.AlSpec.loadFromFetch('automation-spec/');
    } catch (error) {
      showLint(`Спецификация не загружена: ${error.message}`);
      return;
    }
    if (!ui.spec.ok) {
      showLint(`manifest_lint не пройден — запуск заблокирован: ${ui.spec.problems.map((p) => `${p.code} ${p.detail}`).join('; ')}`);
      return;
    }
    let store;
    try {
      store = await root.AlStore.createIdbStore();
    } catch (error) {
      store = root.AlStore.createMemoryStore();
      showLint(`IndexedDB недоступна (${error.message}); состояние хранится только до закрытия вкладки.`);
    }
    simulator = root.AlSimulator.createSimulatorTransport({ latencyMs: 700 });
    if (root.chrome?.runtime?.id) {
      try {
        chromeTransport = root.AlTransport.createChromeTransport();
        chromeTransport.onProgress((progress) => { ui.progress.set(progress.model, progress); scheduleRender(250); });
      } catch (error) {
        console.warn('[AutomationLab] live transport unavailable', error);
      }
    }
    ui.engine = root.AlEngine.createEngine({
      spec: ui.spec,
      store,
      transport: routerTransport,
      onUpdate: (projectId, kind) => {
        if (kind === 'dispatch') ui.progress.clear();
        if (projectId === ui.currentId || kind === 'created') scheduleRender(kind === 'diag' ? 200 : 60);
      },
      log: (line) => console.info('[AutomationLab]', line)
    });
    await ui.engine.recover();
    wireControls();
    const projects = await ui.engine.listProjects();
    const last = readPref('automationLab.current', null);
    ui.currentId = projects.some((project) => project.project_id === last) ? last : null;
    await render();
  }

  function showLint(message) {
    const banner = $('lintBanner');
    banner.textContent = message;
    banner.hidden = false;
  }

  // ---- model selection -------------------------------------------------------------------
  function activeModels() {
    return ui.state?.project?.config?.models || ui.draftModels;
  }

  function renderModelNav() {
    const models = activeModels();
    const locked = ui.engine?.isRunning() || false;
    $('modelNav').replaceChildren(...MODELS.map((model) => {
      const index = models.indexOf(model);
      const icon = root.AlModelIcons?.[model];
      return h('button', {
        type: 'button', class: `model-nav-button${index >= 0 ? ' is-active' : ''}`, title: index === 0 ? `${model} — основная модель` : model,
        disabled: locked, 'aria-pressed': String(index >= 0), onclick: () => toggleModel(model)
      },
      index >= 0 ? h('span', { class: 'model-nav-order' }, index + 1) : null,
      h('span', { class: 'model-nav-icon', style: icon ? `--model-icon:url('${icon}')` : '' }),
      h('span', { class: 'model-nav-label' }, model),
      index === 0 ? h('span', { class: 'primary-mark' }, 'основная') : null);
    }));
  }

  async function toggleModel(model) {
    if (ui.engine?.isRunning()) return;
    let models = activeModels().slice();
    if (models.includes(model)) models = models.filter((item) => item !== model);
    else {
      if (models.length >= MAX_MODELS) { toast(`Максимум ${MAX_MODELS} модели: независимые стадии используют до ${MAX_MODELS} ответов.`); return; }
      models.push(model);
    }
    if (!models.length) { toast('Нужна хотя бы одна модель.'); return; }
    if (ui.state?.project) {
      const { project } = ui.state;
      await ui.engine.setConfig(project.project_id, { ...project.config, models, primary: models[0] });
    } else {
      ui.draftModels = models;
      writePref('automationLab.models', models);
    }
    await render();
  }

  // ---- controls --------------------------------------------------------------------------
  function wireControls() {
    $('composer').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (ui.currentId) return;
      const idea = $('ideaInput').value.trim();
      if (!idea) { toast('Опишите идею продукта.'); $('ideaInput').focus(); return; }
      const models = ui.draftModels;
      if (models.length < 2) { toast('Выберите минимум 2 модели вверху: стадии 2 и 5 требуют независимых ответов разных моделей.', 6000); return; }
      const simulatorMode = $('simulatorToggle').checked || !chromeTransport;
      const projectId = await ui.engine.createProject({ ideaText: idea, models, primaryModel: models[0], timeoutMs: 600000, transportMode: simulatorMode ? 'simulator' : 'live' });
      $('ideaInput').value = '';
      await selectProject(projectId);
      startRun();
    });
    $('ideaInput').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) $('composer').requestSubmit();
    });
    $('newBtn').addEventListener('click', async () => { await selectProject(null); $('ideaInput').focus(); });
    $('projectSelect').addEventListener('change', (event) => selectProject(event.target.value || null));
    $('runBtn').addEventListener('click', startRun);
    $('stopBtn').addEventListener('click', async () => { await ui.engine.stop(); scheduleRender(); });
    $('retryBtn').addEventListener('click', retryStage);
    $('resultsBtn').addEventListener('click', () => openModal('results'));
    $('diagBtn').addEventListener('click', () => openModal('diagnostics'));
    $('reportBtn').addEventListener('click', copyReport);
    $('closeResultsBtn').addEventListener('click', () => { $('resultsModal').hidden = true; });
    $('resultsModal').addEventListener('click', (event) => { if (event.target === $('resultsModal')) $('resultsModal').hidden = true; });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !$('resultsModal').hidden && !$('textDialog').open) $('resultsModal').hidden = true; });
    $('exportJsonBtn').addEventListener('click', exportJson);
    $('exportMdBtn').addEventListener('click', exportMarkdown);
    $('deleteBtn').addEventListener('click', async () => {
      if (!ui.currentId || !confirm('Удалить проект и всё его состояние?')) return;
      await ui.engine.deleteProject(ui.currentId);
      $('resultsModal').hidden = true;
      await selectProject(null);
    });
    $('textDialogCopy').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('textDialogBody').textContent); toast('Скопировано'); } catch (_) { toast('Не удалось скопировать'); }
    });
    document.querySelectorAll('.tabs button').forEach((button) => button.addEventListener('click', () => { ui.modalTab = button.dataset.tab; renderModal(); }));
  }

  function startRun() {
    if (!ui.currentId || ui.engine.isRunning()) return;
    ui.progress.clear();
    ui.engine.run(ui.currentId).catch((error) => { console.error(error); toast(`Ошибка запуска: ${error.message}`, 8000); }).finally(() => scheduleRender());
    scheduleRender();
  }

  async function retryStage() {
    await ui.engine.retry(ui.currentId);
    startRun();
  }

  async function selectProject(projectId) {
    ui.currentId = projectId || null;
    ui.colTab = { left: null, right: null };
    writePref('automationLab.current', ui.currentId);
    await render();
  }

  // ---- rendering -------------------------------------------------------------------------
  async function render() {
    if (!ui.engine) return;
    ui.state = ui.currentId ? await ui.engine.getState(ui.currentId) : null;
    if (ui.currentId && !ui.state) { ui.currentId = null; }
    const running = ui.engine.isRunning();
    const project = ui.state?.project || null;
    const diagnosis = project ? root.AlDiagnostics.diagnose(ui.state, { spec: ui.spec }) : null;
    ui.diagnosis = diagnosis;

    renderModelNav();
    await renderProjectSelect();
    const [label, tone] = project ? (STATE_LABELS[project.workflow_state] || [project.workflow_state, '']) : ['Новый проект', ''];
    $('stateChip').textContent = project && running && project.workflow_state !== 'WAITING_FOR_SELECTION' ? `Выполняется · стадия ${project.running_stage || project.next_stage}` : label;
    $('stateChip').className = `chip ${running ? 'info' : tone}`;
    $('runBtn').hidden = !project || running || !['READY', 'PAUSED'].includes(project.workflow_state);
    $('runBtn').textContent = project?.workflow_state === 'PAUSED' ? 'Продолжить' : 'Запустить';
    $('stopBtn').hidden = !running;
    $('retryBtn').hidden = !project || running || project.workflow_state !== 'STAGE_FAILED';
    $('resultsBtn').disabled = !project;
    $('diagBtn').disabled = !project;
    $('reportBtn').disabled = !project;
    const critical = diagnosis ? diagnosis.problems.filter((problem) => problem.severity === 'critical').length : 0;
    $('diagCount').hidden = !critical;
    $('diagCount').textContent = critical;

    const composer = $('composer');
    composer.classList.toggle('locked', Boolean(project));
    $('ideaInput').disabled = Boolean(project);
    $('sendBtn').disabled = Boolean(project);
    $('ideaInput').placeholder = project
      ? 'Идея этого проекта уже отправлена (см. ленту выше). Для новой идеи нажмите «Новый» вверху.'
      : 'Опишите идею продукта: кто пользователь, какую проблему решаем, какой результат нужен. Ctrl+Enter — запустить.';

    renderStageStrip(diagnosis);
    renderColumns();
    renderCenter(diagnosis);
    if (!$('resultsModal').hidden) renderModal();
  }

  async function renderProjectSelect() {
    const projects = await ui.engine.listProjects();
    const select = $('projectSelect');
    select.replaceChildren(
      h('option', { value: '' }, '— новый проект —'),
      ...projects.map((project) => h('option', { value: project.project_id, selected: project.project_id === ui.currentId },
        `${project.title.slice(0, 48)} · ${(STATE_LABELS[project.workflow_state] || [project.workflow_state])[0]}${project.config?.transport === 'simulator' ? ' · сим.' : ''}`)));
    select.value = ui.currentId || '';
    select.disabled = ui.engine.isRunning();
  }

  function renderStageStrip(diagnosis) {
    const project = ui.state?.project;
    $('stageStrip').replaceChildren(...ui.spec.pilotStages.map((n) => {
      const view = diagnosis?.stages.find((stage) => stage.stage === n);
      let cls = '';
      if (view?.status === 'COMMITTED') cls = 'done';
      if (project?.running_stage === n && ui.engine.isRunning()) cls = 'run';
      if (project?.workflow_state === 'WAITING_FOR_SELECTION' && project.wait?.resume_stage === n + 1) cls = 'wait';
      if (project?.workflow_state === 'STAGE_FAILED' && project.last_error?.stage === n) cls = 'fail';
      const plan = view ? view.expectation : (ui.spec.stage(n).execution?.fanout ? 'все выбранные модели параллельно' : '1 вкладка — основная модель');
      return h('li', { class: `stage-pill ${cls}`, title: `${ui.spec.stage(n).title}\n${plan}` }, `${n}`);
    }));
  }

  // ---- model columns ---------------------------------------------------------------------
  function columnModels() {
    const models = activeModels();
    return { left: models.filter((_, i) => i % 2 === 0), right: models.filter((_, i) => i % 2 === 1) };
  }

  function modelLiveStatus(model) {
    const calls = (ui.state?.calls || []).filter((call) => call.model === model);
    const pendingCall = calls.find((call) => call.attempts.some((attempt) => attempt.status === 'DISPATCHED'));
    if (pendingCall) {
      const progress = ui.progress.get(model);
      if (progress?.chars) return [`генерация · ${progress.chars} симв.`, 'info'];
      return ['получает запрос', 'info'];
    }
    const lastCall = calls.sort((a, b) => String(a.attempts.at(-1)?.dispatched_at || '').localeCompare(String(b.attempts.at(-1)?.dispatched_at || ''))).at(-1);
    const last = lastCall?.attempts.at(-1);
    if (!last) return ['ожидание', ''];
    if (last.outcome === 'ACCEPTED') return [`принят · стадия ${lastCall.stage}`, 'ok'];
    if (last.outcome === 'INTERRUPTED') return ['прерван', 'warn'];
    return [`ошибка · стадия ${lastCall.stage}`, 'err'];
  }

  function renderColumns() {
    const split = columnModels();
    ['left', 'right'].forEach((side) => {
      const models = split[side];
      if (!models.includes(ui.colTab[side])) ui.colTab[side] = models[0] || null;
      const model = ui.colTab[side];
      $(`${side}Tabs`).replaceChildren(...(models.length ? models.map((item) => {
        const [, tone] = modelLiveStatus(item);
        return h('button', { type: 'button', class: 'col-tab', 'aria-selected': String(item === model), onclick: () => { ui.colTab[side] = item; renderColumns(); } },
          item, tone === 'info' && item !== model ? ' •' : '');
      }) : [h('h2', {}, side === 'left' ? 'Модель A' : 'Модель B')]));
      const [statusText, statusTone2] = model ? modelLiveStatus(model) : ['не выбрана', ''];
      $(`${side}Status`).textContent = statusText;
      $(`${side}Status`).className = `col-status chip ${statusTone2}`;
      renderModelFeed($(`${side}Chat`), $(`${side}Request`), model);
    });
  }

  function keepScroll(container, build) {
    const atBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    const previous = container.scrollTop;
    build();
    container.scrollTop = atBottom ? container.scrollHeight : previous;
  }

  function answerText(canonical) {
    if (!canonical) return '';
    const texts = (canonical.outputs || []).filter((output) => output.type === 'ANSWER' || output.type === 'QUESTION').map((output) => output.content).filter(Boolean);
    if (texts.length) return texts.join('\n\n');
    return canonical.completion?.empty_by_design ? 'Пустой результат по замыслу (NO_MATERIAL_DELTA): существенных находок нет.' : '';
  }

  function structureBlock(canonical, call) {
    const tmp = call?.tmp_map || {};
    const inputs = (canonical.passport?.input_refs || []).map((ref) => `${ref.object_id} v${ref.version}`).join(' · ') || '—';
    const outputs = (canonical.outputs || []).map((output) => `${output.id} · ${output.type}`).join(' · ') || '—';
    const trace = (canonical.trace || []).flatMap((entry) => entry.source_ids || []).join(' + ') || '—';
    const fate = (canonical.input_fate || []).map((entry) => `${entry.input_id} → ${entry.disposition}`).join(' · ') || '—';
    const dispositions = (canonical.dispositions || []).map((entry) => `${entry.input_ref.object_id} → ${entry.action}`).join(' · ');
    const changes = (canonical.changes || []).map((change) => {
      const canonicalId = change.temp_id && tmp[change.temp_id] ? ` → ${tmp[change.temp_id].object_id}` : '';
      return `${change.op} · ${change.object_type}${change.temp_id ? ` · ${change.temp_id}${canonicalId}` : ''}`;
    }).join('\n') || '—';
    const n = Number(canonical.completion?.output_count || 0);
    const row = (key, value, cls = '') => h('div', { class: 'structure-row' }, h('div', { class: 'structure-key' }, key), h('div', { class: `structure-val ${cls}` }, value));
    return h('div', { class: 'structure' },
      row('Snapshot', canonical.passport?.input_snapshot_id || '—'),
      row('Inputs', inputs),
      row('Output', outputs),
      row('Annotations', h('span', { class: 'tags' }, (canonical.annotations || []).length ? canonical.annotations.map((a) => h('span', { class: 'tag' }, a.type)) : h('span', { class: 'tag' }, 'none'))),
      row('Trace', trace),
      row('Input fate', fate),
      dispositions ? row('Dispositions', dispositions) : null,
      row('Changes', changes),
      row('Completion', `${canonical.completion?.status || '—'} · ${n} output${n === 1 ? '' : 's'}${canonical.completion?.empty_by_design ? ' · EMPTY_BY_DESIGN' : ''}`, 'completion'));
  }

  function nextStepText(call, attempt, index) {
    const later = call.attempts[index + 1];
    if (later) return later.kind === 'repair' ? 'Дальше: ремонт в том же чате.' : 'Дальше: новая попытка в новом чате.';
    if (call.status === 'FAILED') return 'Попытки исчерпаны.';
    if (attempt.outcome === 'REPAIRABLE') return 'Будет запрошен исправленный ответ в том же чате.';
    if (attempt.outcome === 'INTERRUPTED') return 'Будет повторено после «Продолжить».';
    return 'Будет новая попытка в новом чате.';
  }

  function attemptError(call, attempt, index) {
    const first = (attempt.errors || [])[0] || { code: attempt.outcome, message: '' };
    const code = first.class === 'TRANSPORT' && /TIMEOUT/.test(first.code) ? 'TIMEOUT' : first.code;
    const text = root.AlDiagnostics.explain(code, first.message);
    const others = (attempt.errors || []).slice(1, 5).map((error) => `${error.code}: ${error.message}`);
    return h('div', { class: `msg ${attempt.outcome === 'REPAIRABLE' ? 'warn' : 'error'}` },
      h('div', { class: 'msg-head' }, `${call.model}`, h('span', { class: 'sub' }, `ответ не принят · ${time(attempt.finished_at)}`)),
      h('div', { class: 'bubble' }, h('strong', {}, text.title), '\n', text.detail,
        others.length ? `\n${others.join('\n')}` : '',
        h('span', { class: 'hint' }, nextStepText(call, attempt, index)),
        attempt.raw_text ? h('button', { type: 'button', class: 'link-btn', onclick: () => openText(`Сырой ответ · ${call.model} · ${attempt.attempt_id}`, attempt.raw_text) }, 'Показать сырой ответ') : null));
  }

  function renderModelFeed(container, requestView, model) {
    const calls = (ui.state?.calls || []).filter((call) => call.model === model);
    let sending = null;
    keepScroll(container, () => {
      if (!model || !calls.length) {
        container.className = 'chat empty';
        container.replaceChildren(h('p', { class: 'placeholder' }, model
          ? `${model}: запросов ещё не было. ${model === activeModels()[0] ? 'Это основная модель — она работает на стадиях 1, 3, 4 и участвует в 2 и 5.' : 'Эта модель участвует в независимых стадиях 2 и 5.'}`
          : 'Выберите модели вверху.'));
        return;
      }
      container.className = 'chat';
      const sections = ui.spec.pilotStages.map((n) => {
        const stageCalls = calls.filter((call) => call.stage === n);
        if (!stageCalls.length) return null;
        const items = [];
        stageCalls.forEach((call) => call.attempts.forEach((attempt, index) => {
          items.push(h('div', { class: 'msg user' },
            h('div', { class: 'msg-head' }, 'Automation', h('span', { class: 'sub' }, `→ ${model} · попытка ${index + 1} · ${attempt.kind === 'repair' ? 'ремонт в том же чате' : 'новый чат'} · ${time(attempt.dispatched_at)}`)),
            h('div', { class: 'bubble long' }, attempt.prompt_text || '(промпт не сохранён)')));
          if (attempt.status === 'DISPATCHED') {
            sending = attempt.prompt_text;
            const progress = ui.progress.get(model);
            items.push(h('div', { class: 'msg' }, h('div', { class: 'msg-head' }, model),
              h('div', { class: 'thinking' }, h('span', {}, progress?.chars ? `формирует ответ · ${progress.chars} симв.` : 'ожидает ответа'), h('span', { class: 'dot' }), h('span', { class: 'dot' }), h('span', { class: 'dot' }))));
          } else if (attempt.outcome === 'ACCEPTED' && call.accepted?.attempt_id === attempt.attempt_id) {
            items.push(h('div', { class: 'msg ok' },
              h('div', { class: 'msg-head' }, model, h('span', { class: 'sub' }, `принят · ${fmtMs(attempt.duration_ms)} · ${attempt.extraction_mode}`)),
              h('div', { class: 'bubble' }, h('div', { class: 'answer-text' }, answerText(call.accepted.canonical)), structureBlock(call.accepted.canonical, call))));
          } else if (attempt.outcome) {
            items.push(attemptError(call, attempt, index));
          }
        }));
        return h('section', { class: 'round' }, h('div', { class: 'round-title' }, h('span', {}, `Стадия ${n} · ${ui.spec.stage(n).title}`)), items);
      }).filter(Boolean);
      container.replaceChildren(...sections);
    });
    requestView.className = sending ? 'request-view sending' : 'request-view empty';
    requestView.textContent = sending || 'запрос к модели';
  }

  // ---- center feed -----------------------------------------------------------------------
  function renderCenter(diagnosis) {
    const container = $('centerChat');
    const state = ui.state;
    if (!state) {
      container.className = 'chat center-chat empty';
      container.replaceChildren(h('div', { class: 'placeholder' },
        h('p', {}, h('strong', {}, 'Стадии 1–5 Product→Architecture.')),
        h('ol', {},
          h('li', {}, `Выберите модели вверху (минимум 2, сейчас: ${ui.draftModels.join(', ') || 'нет'}). Первая выбранная — основная: она одна работает на стадиях 1, 3 и 4 — там откроется 1 вкладка.`),
          h('li', {}, 'Опишите идею продукта внизу и нажмите «Запустить».'),
          h('li', {}, 'На стадиях 2 и 5 все выбранные модели отвечают параллельно — каждая в новой вкладке.'),
          h('li', {}, 'Дважды система спросит вас: утвердить Decision Policy и выбрать варианты решений. Вопросы появятся здесь, в ленте.'),
          h('li', {}, 'Если что-то пошло не так — «Диагностика» объяснит причину, «Отчёт для Claude» соберёт всё для разбора.'))));
      return;
    }
    const form = container.querySelector('form.owner-form');
    const previous = form ? new FormData(form) : null;
    keepScroll(container, () => {
      container.className = 'chat center-chat';
      const { project, calls, execs, events, diag, latest } = state;
      const byId = new Map(latest.map((entry) => [entry.object_id, entry]));
      const idea = byId.get('IDEA-0001');
      const sections = [];
      ui.spec.pilotStages.forEach((n) => {
        const stageExecs = execs.filter((exec) => exec.stage === n);
        const view = diagnosis.stages.find((stage) => stage.stage === n);
        const isNext = project.next_stage === n && ['READY', 'PAUSED'].includes(project.workflow_state);
        if (!stageExecs.length && !(n === 1) && !isNext) return;
        const items = [];
        items.push(h('p', { class: 'phase-note' }, `Ожидается: ${view.expectation}${ui.spec.stage(n).execution?.fanout ? `; для фиксации нужно ≥${ui.spec.stage(n).execution.fanout.min_distinct_models} принятых ответа` : ''}.`));
        if (n === 1 && idea) items.push(h('div', { class: 'msg user' }, h('div', { class: 'msg-head' }, 'Владелец', h('span', { class: 'sub' }, 'идея продукта')), h('div', { class: 'bubble' }, idea.payload.raw_text)));
        if (!stageExecs.length) items.push(h('div', { class: 'msg system' }, h('div', { class: 'bubble' }, ui.engine.isRunning() ? 'Готовлю запрос…' : 'Стадия ещё не запускалась.')));

        stageExecs.forEach((exec, runIndex) => {
          if (stageExecs.length > 1) items.push(h('p', { class: 'phase-note' }, `Запуск ${runIndex + 1} · ${exec.status}`));
          diag.filter((event) => event.exec_id === exec.exec_id && event.source === 'transport' && ['DISPATCH_SENT', 'DISPATCH_REJECTED', 'BACKGROUND_BUSY'].includes(event.kind)).forEach((event) => {
            if (event.kind === 'DISPATCH_SENT') items.push(h('div', { class: 'msg system' }, h('div', { class: 'bubble' }, `${time(event.at)} · ${event.freshConversation ? 'Отправлено в новые чаты' : 'Ремонт в том же чате'}: ${(event.models || []).join(', ')} (${(event.models || []).length} ${root.AlDiagnostics.plural((event.models || []).length, 'вкладка', 'вкладки', 'вкладок')})`)));
            if (event.kind === 'BACKGROUND_BUSY') items.push(h('div', { class: 'msg warn' }, h('div', { class: 'bubble' }, `${time(event.at)} · Ждём: в расширении ещё идёт другой запуск (Pipeline/Debate).`)));
            if (event.kind === 'DISPATCH_REJECTED') items.push(h('div', { class: 'msg error' }, h('div', { class: 'bubble' }, `${time(event.at)} · Фон отказался отправлять: ${event.code}`)));
          });
          calls.filter((call) => exec.call_ids.includes(call.call_id)).forEach((call) => {
            if (call.accepted) {
              items.push(h('div', { class: 'msg ok' }, h('div', { class: 'msg-head' }, call.model, h('span', { class: 'sub' }, `принят с попытки ${call.attempts.findIndex((a) => a.attempt_id === call.accepted.attempt_id) + 1}`)),
                h('div', { class: 'bubble' }, answerText(call.accepted.canonical) || '—')));
            } else if (call.attempts.some((attempt) => attempt.status === 'DISPATCHED')) {
              const progress = ui.progress.get(call.model);
              items.push(h('div', { class: 'msg' }, h('div', { class: 'msg-head' }, call.model), h('div', { class: 'thinking' }, h('span', {}, progress?.chars ? `формирует ответ · ${progress.chars} симв.` : 'ожидает ответа'), h('span', { class: 'dot' }), h('span', { class: 'dot' }), h('span', { class: 'dot' }))));
            } else if (call.status === 'FAILED') {
              const last = call.attempts.at(-1);
              const first = (last?.errors || [])[0];
              items.push(h('div', { class: 'msg error' }, h('div', { class: 'msg-head' }, call.model, h('span', { class: 'sub' }, `исключена после ${call.attempts.length} попыток`)),
                h('div', { class: 'bubble' }, first ? root.AlDiagnostics.explain(first.class === 'TRANSPORT' && /TIMEOUT/.test(first.code) ? 'TIMEOUT' : first.code, first.message).title : 'ошибка')));
            }
          });
          if (exec.status === 'COMMITTED') {
            const committed = events.find((event) => event.event_type === 'STAGE_RUN_COMMITTED' && event.payload.exec_id === exec.exec_id);
            const created = committed?.payload.created || [];
            const byCode = {};
            created.forEach((item) => { byCode[item.code] = (byCode[item.code] || 0) + 1; });
            items.push(h('div', { class: 'msg ok' }, h('div', { class: 'msg-head' }, 'Зафиксировано', h('span', { class: 'sub' }, time(exec.committed_at))),
              h('div', { class: 'bubble' }, `Создано объектов: ${created.length} (${Object.entries(byCode).map(([code, count]) => `${CODE_LABELS[code] || code}: ${count}`).join(', ')})${committed?.payload.status_changes?.length ? `; изменено статусов: ${committed.payload.status_changes.length}` : ''}.`)));
          }
        });

        diagnosis.problems.filter((problem) => problem.stage === n && ['critical'].includes(problem.severity) && problem.code !== 'MODEL_FAILED').slice(0, 4).forEach((problem) => {
          items.push(h('div', { class: 'msg error' }, h('div', { class: 'msg-head' }, 'Диагноз', h('span', { class: 'sub' }, problem.code)),
            h('div', { class: 'bubble' }, h('strong', {}, problem.title), problem.detail ? `\n${problem.detail}` : '', problem.hint ? h('span', { class: 'hint' }, `Что делать: ${problem.hint}`) : null)));
        });

        if (project.workflow_state === 'STAGE_FAILED' && project.last_error?.stage === n) {
          items.push(h('div', { class: 'msg error' }, h('div', { class: 'msg-head' }, 'Стадия не прошла'),
            h('div', { class: 'bubble' }, `${project.last_error.code}: ${project.last_error.message || ''}\nСостояние проекта не изменено.`,
              h('div', { class: 'modal-actions', style: 'margin-top:8px;justify-content:flex-start' },
                h('button', { type: 'button', class: 'primary', onclick: retryStage }, 'Повторить стадию'),
                h('button', { type: 'button', class: 'secondary', onclick: () => openModal('diagnostics') }, 'Диагностика'),
                h('button', { type: 'button', class: 'secondary', onclick: copyReport }, 'Отчёт для Claude')))));
        }

        const waitingHere = project.workflow_state === 'WAITING_FOR_SELECTION' && project.wait?.resume_stage === n + 1;
        if (waitingHere) items.push(ownerCard(project, byId, previous));
        else items.push(...answeredSummary(n, latest, byId));

        const [chipText, chipTone] = stageChip(project, n, stageExecs);
        sections.push(h('section', { class: 'round' }, h('div', { class: 'round-title' }, h('span', {}, `Стадия ${n} · ${ui.spec.stage(n).title}`), chip(chipText, chipTone)), items));
      });
      if (project.workflow_state === 'PILOT_COMPLETE') sections.push(finalSummary(latest));
      container.replaceChildren(...sections);
    });
  }

  function stageChip(project, n, stageExecs) {
    const exec = stageExecs.at(-1);
    if (project.workflow_state === 'WAITING_FOR_SELECTION' && project.wait?.resume_stage === n + 1) return ['ждёт вас', 'warn'];
    if (exec?.status === 'COMMITTED') return ['зафиксирована', 'ok'];
    if (project.workflow_state === 'STAGE_FAILED' && project.last_error?.stage === n) return ['не прошла', 'err'];
    if (exec?.status === 'RUNNING') return [ui.engine.isRunning() ? 'выполняется' : 'прервана', ui.engine.isRunning() ? 'info' : 'warn'];
    return ['ожидает', ''];
  }

  function ownerCard(project, byId, previous) {
    const questions = project.wait.qst_ids.map((id) => byId.get(id)).filter((qst) => qst && ['READY', 'ASKED'].includes(qst.status));
    const form = h('form', { class: 'owner-card owner-form' },
      h('h3', {}, 'Ваше решение'),
      h('p', { class: 'note' }, 'Выбор только из вариантов. Выбранные эффекты применяет детерминированный компилятор ответов — модель ваш выбор не переосмысливает. Пока вы не ответите, модели не вызываются.'),
      questions.map((qst) => {
        const subject = qst.payload.decision_ref ? byId.get(qst.payload.decision_ref.object_id) : null;
        const multi = qst.payload.input_type === 'MULTI';
        return h('fieldset', { class: 'question' },
          h('legend', {}, qst.payload.question),
          h('span', { class: 'meta' }, `${qst.object_id} · класс ${qst.payload.authority_class}${subject ? ` · ${subject.object_id}` : ''}${qst.payload.required ? ' · обязательный' : ''}`),
          subject?.code === 'DPL' ? dplTable(subject) : null,
          subject?.code === 'PD' ? h('span', { class: 'meta' }, `Решение: ${subject.payload.question}`) : null,
          qst.payload.options.map((option) => optionLabel(qst, option, multi, previous)));
      }),
      h('div', {}, h('button', { type: 'submit', class: 'primary' }, 'Применить выбор и продолжить')));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const answers = Object.fromEntries(questions.map((qst) => [qst.object_id, data.getAll(qst.object_id)]));
      try {
        await ui.engine.answer(ui.currentId, answers);
        startRun();
      } catch (error) {
        toast(`Ответ не принят: ${error.message}`, 6000);
      }
    });
    return form;
  }

  function effectsText(option) {
    return option.effects.map((effect) => {
      const value = effect.value != null && effect.effect_type !== 'ACTIVATE_DPL' ? `: ${effect.value}` : '';
      return `${effect.effect_type}${value}`;
    }).join(' · ');
  }

  function optionLabel(qst, option, multi, previous) {
    const checked = previous ? previous.getAll(qst.object_id).includes(option.option_id) : false;
    const input = h('input', { type: multi ? 'checkbox' : 'radio', name: qst.object_id, value: option.option_id, required: !multi && qst.payload.required, checked });
    const text = h('span', {}, option.label, h('br'), h('span', { class: 'meta' }, effectsText(option)));
    return h('label', {}, input, text);
  }

  function answeredSummary(n, latest, byId) {
    const answered = latest.filter((entry) => entry.code === 'QST' && entry.created_stage === n && entry.status === 'ANSWERED');
    return answered.map((qst) => {
      const answer = latest.find((entry) => entry.code === 'QANS' && entry.payload.question_ref.object_id === qst.object_id);
      const chosen = answer ? qst.payload.options.filter((option) => answer.payload.selected_option_ids.includes(option.option_id)).map((option) => option.label).join(', ') : '—';
      void byId;
      return h('div', { class: 'msg user' }, h('div', { class: 'msg-head' }, 'Владелец', h('span', { class: 'sub' }, `ответ на ${qst.object_id}`)), h('div', { class: 'bubble' }, `${qst.payload.question}\n→ ${chosen}`));
    });
  }

  function dplTable(dpl) {
    return h('table', { class: 'mini-table' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Класс'), h('th', {}, 'Режим'), h('th', {}, 'Макс. риск'), h('th', {}, 'Виды решений'))),
      h('tbody', {}, (dpl.payload.authority_rules || []).map((rule) => h('tr', {}, h('td', {}, rule.authority_class), h('td', {}, rule.mode), h('td', {}, rule.max_risk), h('td', {}, (rule.decision_kinds || []).join(', '))))));
  }

  function finalSummary(latest) {
    const pcon = latest.find((entry) => entry.code === 'PCON' && entry.status === 'ACTIVE');
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    const findings = latest.filter((entry) => entry.code === 'FND').sort((a, b) => rank[a.payload.severity] - rank[b.payload.severity]);
    return h('div', { class: 'summary-card' },
      h('h3', {}, 'Стадии 1–5 завершены'),
      pcon ? h('p', {}, pcon.payload.summary) : null,
      findings.length ? h('div', {}, h('strong', {}, `Находки независимого ревью: ${findings.length}`), h('ul', {}, findings.slice(0, 6).map((entry) => h('li', {}, `${entry.payload.severity} · ${entry.payload.class}: ${entry.payload.description}`)))) : null,
      h('div', { class: 'modal-actions', style: 'margin-top:8px;justify-content:flex-start' },
        h('button', { type: 'button', class: 'primary', onclick: () => openModal('results') }, 'Открыть результаты'),
        h('button', { type: 'button', class: 'secondary', onclick: exportMarkdown }, 'Экспорт .md')));
  }

  // ---- modal: results / diagnostics / calls / telemetry / registry / events -------------------
  function openModal(tab) {
    if (!ui.state) return;
    ui.modalTab = tab;
    $('resultsModal').hidden = false;
    renderModal();
  }

  function renderModal() {
    if (!ui.state) return;
    document.querySelectorAll('.tabs button').forEach((button) => button.setAttribute('aria-selected', String(button.dataset.tab === ui.modalTab)));
    const panels = { results: 'tabResults', diagnostics: 'tabDiagnostics', calls: 'tabCalls', telemetry: 'tabTelemetry', registry: 'tabRegistry', events: 'tabEvents' };
    Object.entries(panels).forEach(([name, id]) => { $(id).hidden = name !== ui.modalTab; });
    if (ui.modalTab === 'results') renderResults(ui.state);
    if (ui.modalTab === 'diagnostics') {
      const panel = $('tabDiagnostics');
      panel.className = 'tab-panel ald-root';
      root.AlDiagnosticsView.render(panel, ui.state, { spec: ui.spec });
    }
    if (ui.modalTab === 'calls') renderCalls(ui.state);
    if (ui.modalTab === 'telemetry') renderTelemetry(ui.state);
    if (ui.modalTab === 'registry') renderRegistry(ui.state);
    if (ui.modalTab === 'events') renderEvents(ui.state);
  }

  function objCard(entry, body, wide = false) {
    return h('article', { class: `obj-card${wide ? ' wide' : ''}` },
      h('header', {}, h('span', { class: 'obj-id' }, `${entry.object_id} v${entry.version} · стадия ${entry.created_stage}`), chip(entry.status, statusTone(entry.status))),
      body);
  }
  const listBlock = (title, items) => (items?.length ? h('div', {}, h('span', { class: 'muted' }, title), h('ul', {}, items.map((item) => h('li', {}, item)))) : null);

  function renderResults(state) {
    const live = state.latest.filter((entry) => entry.status !== 'SUPERSEDED');
    const of = (code) => live.filter((entry) => entry.code === code);
    const section = (code, cards) => (cards.length ? [h('h3', {}, `${CODE_LABELS[code] || code} (${cards.length})`), h('div', { class: 'card-list' }, cards)] : []);
    const blocks = [];
    const pcon = of('PCON')[0];
    if (pcon) {
      blocks.push(h('h3', {}, 'Концепция продукта (PCON)'), h('div', { class: 'card-list' }, objCard(pcon, [
        h('p', {}, pcon.payload.summary), h('p', { class: 'muted' }, `Акторы: ${(pcon.payload.actors || []).join(', ')}`),
        listBlock('Сценарии', pcon.payload.scenarios), listBlock('Скоуп', pcon.payload.scope), listBlock('Правила и открытые вопросы', pcon.payload.rules)], true)));
    }
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    blocks.push(...section('FND', of('FND').sort((a, b) => rank[a.payload.severity] - rank[b.payload.severity]).map((entry) => objCard(entry, [
      h('p', {}, chip(entry.payload.severity, entry.payload.severity === 'HIGH' || entry.payload.severity === 'CRITICAL' ? 'err' : 'warn'), ' ', h('strong', {}, entry.payload.class)),
      h('p', {}, entry.payload.description), h('p', { class: 'muted' }, `→ ${entry.payload.proposed_route}`)]))));
    blocks.push(...section('PD', of('PD').map((entry) => objCard(entry, [
      h('p', {}, h('strong', {}, entry.payload.question)),
      h('p', {}, entry.payload.decision ? `Решение: ${entry.payload.decision}` : h('span', { class: 'muted' }, 'Решение не принято')),
      h('p', { class: 'muted' }, `${entry.authority_class || '—'} · ${entry.payload.decided_by}`)]))));
    blocks.push(...section('DPL', of('DPL').map((entry) => objCard(entry, dplTable(entry), true))));
    blocks.push(...section('PRP', of('PRP').map((entry) => objCard(entry, [h('p', {}, h('strong', {}, entry.payload.kind), ` · ${entry.payload.source_model}`), h('p', {}, entry.payload.statement), h('p', { class: 'muted' }, entry.payload.rationale)]))));
    blocks.push(...section('UNK', of('UNK').map((entry) => objCard(entry, [h('p', {}, entry.payload.question), h('p', { class: 'muted' }, `маршрут: ${entry.payload.route}${entry.blocking ? ' · блокирующий' : ''}`)]))));
    blocks.push(...section('ASM', of('ASM').map((entry) => objCard(entry, [h('p', {}, entry.payload.statement), h('p', { class: 'muted' }, `нужно: ${entry.payload.needed_evidence}`)]))));
    blocks.push(...section('RSK', of('RSK').map((entry) => objCard(entry, [h('p', {}, entry.payload.failure_class), h('p', { class: 'muted' }, `${entry.payload.likelihood}/${entry.payload.impact} · ${entry.payload.mitigation}`)]))));
    const idea = of('IDEA')[0];
    if (idea) blocks.push(h('h3', {}, 'Исходная идея'), h('div', { class: 'card-list' }, objCard(idea, h('p', {}, idea.payload.raw_text), true)));
    if (!blocks.length) blocks.push(h('p', { class: 'muted' }, 'Результатов пока нет.'));
    $('tabResults').replaceChildren(...blocks);
  }

  function openText(title, text) {
    $('textDialogTitle').textContent = title;
    $('textDialogBody').textContent = text == null ? '—' : text;
    $('textDialog').showModal();
  }

  const OUTCOME_TONES = { ACCEPTED: 'ok', REPAIRABLE: 'warn', REJECTED: 'err', TRANSPORT_FAILED: 'err', INTERRUPTED: 'warn' };
  function renderCalls(state) {
    const blocks = state.execs.slice().reverse().map((exec) => {
      const rows = state.calls.filter((call) => exec.call_ids.includes(call.call_id)).flatMap((call) => call.attempts.map((attempt, index) => h('tr', {},
        h('td', {}, index === 0 ? [call.model, ' ', chip(call.status, statusTone(call.status))] : ''),
        h('td', {}, `${index + 1} · ${attempt.kind}`),
        h('td', {}, chip(attempt.outcome || attempt.status, OUTCOME_TONES[attempt.outcome] || 'info')),
        h('td', {}, attempt.extraction_mode || '—'),
        h('td', { class: 'num' }, fmtMs(attempt.duration_ms)),
        h('td', { class: 'num' }, attempt.prompt_chars ?? '—'),
        h('td', {}, (attempt.errors || []).slice(0, 4).map((error) => h('div', {}, h('code', {}, error.code), ` ${error.message}`))),
        h('td', {}, h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'secondary', onclick: () => openText(`Промпт · ${call.model} · ${attempt.attempt_id}`, attempt.prompt_text) }, 'Промпт'),
          h('button', { type: 'button', class: 'secondary', onclick: () => openText(`Сырой ответ · ${call.model} · ${attempt.attempt_id}`, attempt.raw_text) }, 'Ответ'),
          attempt.context_audit ? h('button', { type: 'button', class: 'secondary', onclick: () => openText(`ContextAssemblyAudit · ${attempt.attempt_id}`, JSON.stringify(attempt.context_audit, null, 2)) }, 'Аудит') : null)))));
      return h('section', { class: 'panel-block' },
        h('h3', {}, `Стадия ${exec.stage} · ${exec.exec_id} `, chip(exec.status, statusTone(exec.status))),
        h('p', { class: 'muted mono' }, `snapshot ${exec.snapshot_id} · hash ${exec.input_snapshot_hash}`),
        h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
          h('thead', {}, h('tr', {}, ['Модель', 'Попытка', 'Итог', 'Извлечение', 'Длит.', 'Промпт', 'Ошибки', ''].map((title) => h('th', {}, title)))),
          h('tbody', {}, rows))));
    });
    $('tabCalls').replaceChildren(...(blocks.length ? blocks : [h('p', { class: 'muted' }, 'Вызовов ещё не было.')]));
  }

  function renderTelemetry(state) {
    const rows = root.AlDiagnostics.providerMatrix(state.calls);
    const totals = rows.reduce((acc, row) => ({ calls: acc.calls + row.calls, attempts: acc.attempts + row.attempts, repairs: acc.repairs + row.repairs }), { calls: 0, attempts: 0, repairs: 0 });
    const fanoutCalls = state.calls.filter((call) => ui.spec.stage(call.stage)?.independent).length;
    const created = state.events.find((event) => event.event_type === 'PROJECT_CREATED');
    const lastCommit = [...state.events].reverse().find((event) => event.event_type === 'STAGE_RUN_COMMITTED');
    const wall = created && lastCommit ? Date.parse(lastCommit.at) - Date.parse(created.at) : null;
    $('tabTelemetry').replaceChildren(
      h('p', { class: 'muted' }, `Измерено: вызовов моделей ${totals.calls}, попыток ${totals.attempts}, ремонтов ${totals.repairs}, fan-out вызовов ${fanoutCalls}, время до последней фиксации ${fmtMs(wall)} (включая ожидание владельца).`),
      h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, ['Провайдер', 'Вызовы', 'Попытки', 'С первого раза', 'Ремонт → успех', 'Принято', 'Сбой транспорта', 'Сбой извлечения', 'Сбой схемы', 'Хеш ≠', 'Медиана', 'p95', 'Режимы'].map((title) => h('th', {}, title)))),
        h('tbody', {}, rows.map((row) => h('tr', {},
          h('td', {}, row.model), h('td', { class: 'num' }, row.calls), h('td', { class: 'num' }, row.attempts),
          h('td', { class: 'num' }, pct(row.firstPass / row.calls)), h('td', { class: 'num' }, row.repairs ? `${row.repairOk}/${row.repairs}` : '—'),
          h('td', { class: 'num' }, pct(row.accepted / row.calls)), h('td', { class: 'num' }, pct(row.transportFail / row.attempts)),
          h('td', { class: 'num' }, pct(row.extractFail / row.attempts)), h('td', { class: 'num' }, pct(row.schemaFail / row.attempts)),
          h('td', { class: 'num' }, pct(row.hashMismatch / row.attempts)), h('td', { class: 'num' }, fmtMs(row.median)), h('td', { class: 'num' }, fmtMs(row.p95)),
          h('td', {}, Object.entries(row.modes).map(([mode, count]) => `${mode}×${count}`).join(', ') || '—')))))));
  }

  function renderRegistry(state) {
    const versions = new Map();
    state.records.forEach((record) => versions.set(record.object_id, (versions.get(record.object_id) || 0) + 1));
    $('tabRegistry').replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['ID', 'Тип', 'Версия', 'Статус', 'Класс', 'Стадия', 'Создан прогоном', 'content_hash', ''].map((title) => h('th', {}, title)))),
      h('tbody', {}, state.latest.map((entry) => h('tr', {},
        h('td', {}, h('code', {}, entry.object_id)), h('td', {}, entry.code), h('td', { class: 'num' }, `${entry.version}${versions.get(entry.object_id) > 1 ? ` (${versions.get(entry.object_id)})` : ''}`),
        h('td', {}, chip(entry.status, statusTone(entry.status))), h('td', {}, entry.authority_class || '—'), h('td', { class: 'num' }, entry.created_stage),
        h('td', {}, h('code', {}, entry.created_by_run)), h('td', {}, h('code', {}, entry.content_hash.slice(0, 12))),
        h('td', {}, h('button', { type: 'button', class: 'secondary', onclick: () => openText(`${entry.object_id} v${entry.version}`, JSON.stringify(entry, null, 2)) }, 'JSON'))))))));
  }

  function renderEvents(state) {
    $('tabEvents').replaceChildren(h('div', { class: 'table-wrap' }, h('table', { class: 'data' },
      h('thead', {}, h('tr', {}, ['#', 'Время', 'Событие', 'rev', 'Данные'].map((title) => h('th', {}, title)))),
      h('tbody', {}, state.events.slice().reverse().map((event) => h('tr', {},
        h('td', { class: 'num' }, event.event_id), h('td', {}, time(event.at)), h('td', {}, event.event_type), h('td', { class: 'num' }, event.project_revision),
        h('td', {}, h('details', {}, h('summary', {}, Object.keys(event.payload || {}).join(', ')), h('pre', { class: 'mono' }, JSON.stringify(event.payload, null, 2))))))))));
  }

  // ---- export & report -------------------------------------------------------------------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = h('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function copyReport() {
    if (!ui.currentId) return;
    const state = await ui.engine.getState(ui.currentId);
    const report = root.AlDiagnostics.buildReport(state, { spec: ui.spec, extensionVersion: root.chrome?.runtime?.getManifest?.().version || null });
    const text = JSON.stringify(report, null, 2);
    download(`automation-report-${state.project.project_id}.json`, text, 'application/json');
    try {
      await navigator.clipboard.writeText(text);
      toast('Отчёт скопирован в буфер и сохранён файлом. Вставьте его в чат с Claude или приложите файл.', 7000);
    } catch (_) {
      toast('Отчёт сохранён файлом (automation-report-….json). Приложите его в чат с Claude.', 7000);
    }
  }

  async function exportJson() {
    const state = await ui.engine.getState(ui.currentId);
    download(`${state.project.project_id}.automation.json`, JSON.stringify({ spec_version: ui.spec.version, exported_at: new Date().toISOString(), ...state }, null, 2), 'application/json');
  }

  async function exportMarkdown() {
    const state = await ui.engine.getState(ui.currentId);
    download(`${state.project.project_id}.md`, buildMarkdown(state), 'text/markdown');
  }

  function buildMarkdown(state) {
    const live = state.latest.filter((entry) => entry.status !== 'SUPERSEDED');
    const of = (code) => live.filter((entry) => entry.code === code);
    const esc = (value) => String(value ?? '—').replace(/\|/g, '\\|').replace(/\n/g, ' ');
    const lines = [`# ${state.project.title}`, '', `Проект ${state.project.project_id} · spec v${ui.spec.version} · состояние ${state.project.workflow_state}`, ''];
    const idea = of('IDEA')[0];
    if (idea) lines.push('## Идея', '', idea.payload.raw_text, '');
    const pcon = of('PCON')[0];
    if (pcon) {
      lines.push('## Концепция продукта', '', pcon.payload.summary, '', `**Акторы:** ${pcon.payload.actors.join(', ')}`, '');
      [['Сценарии', pcon.payload.scenarios], ['Скоуп', pcon.payload.scope], ['Правила и открытые вопросы', pcon.payload.rules]].forEach(([title, items]) => {
        if (items?.length) lines.push(`### ${title}`, '', ...items.map((item) => `- ${item}`), '');
      });
    }
    if (of('FND').length) lines.push('## Находки независимого ревью', '', '| ID | Серьёзность | Класс | Описание |', '|---|---|---|---|', ...of('FND').map((e) => `| ${e.object_id} | ${e.payload.severity} | ${e.payload.class} | ${esc(e.payload.description)} |`), '');
    if (of('PD').length) lines.push('## Решения', '', '| ID | Статус | Класс | Вопрос | Решение | Кем |', '|---|---|---|---|---|---|', ...of('PD').map((e) => `| ${e.object_id} | ${e.status} | ${e.authority_class || ''} | ${esc(e.payload.question)} | ${esc(e.payload.decision)} | ${e.payload.decided_by} |`), '');
    const dpl = of('DPL').find((e) => e.status === 'ACTIVE');
    if (dpl) lines.push('## Decision Policy', '', '| Класс | Режим | Макс. риск |', '|---|---|---|', ...dpl.payload.authority_rules.map((r) => `| ${r.authority_class} | ${r.mode} | ${r.max_risk} |`), '');
    if (of('UNK').length) lines.push('## Открытые неизвестные', '', ...of('UNK').map((e) => `- ${e.payload.question} (${e.payload.route})`), '');
    if (of('RSK').length) lines.push('## Риски', '', ...of('RSK').map((e) => `- ${e.payload.failure_class}: ${e.payload.likelihood}/${e.payload.impact} — ${e.payload.mitigation}`), '');
    return lines.join('\n');
  }

  root.AutomationLab = Object.freeze({ buildMarkdown });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { boot().catch((error) => showLint(`Ошибка запуска: ${error.message}`)); });
  else boot().catch((error) => showLint(`Ошибка запуска: ${error.message}`));
})(window);
