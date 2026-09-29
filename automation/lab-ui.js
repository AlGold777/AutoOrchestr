// Automation Lab — page controller. The page is UI only: every button calls the restartable
// engine, and every view is re-rendered from persisted state. Model and user text is rendered via
// textContent only.
(function initAutomationLab(root) {
  'use strict';

  const MODELS = ['Claude', 'GPT', 'Gemini', 'Grok', 'Le Chat', 'Qwen', 'DeepSeek', 'Perplexity', 'Z.ai', 'Kimi'];
  const DEFAULT_MODELS = ['Claude', 'GPT', 'Gemini'];
  const STATE_LABELS = {
    READY: ['Готов к запуску', 'info'],
    RUNNING: ['Выполняется', 'info'],
    PAUSED: ['Пауза', 'warn'],
    WAITING_FOR_SELECTION: ['Ждёт решения владельца', 'warn'],
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
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    });
    children.flat(Infinity).forEach((child) => {
      if (child === undefined || child === null || child === false) return;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    });
    return node;
  }
  const badge = (text, tone = '') => h('span', { class: `badge ${tone}` }, text);
  const statusTone = (status) => ({ ACTIVE: 'ok', CLOSED: 'ok', ANSWERED: 'ok', COMPILED: 'ok', RECORDED: 'ok', COMMITTED: 'ok', ACCEPTED: 'ok', OPEN: 'warn', READY: 'warn', NEEDS_EVIDENCE: 'warn', DRAFT: 'warn', UNVERIFIED: 'warn', DEFERRED: '', PROPOSED: 'info', FAILED: 'err', REJECTED: 'err', SUPERSEDED: '', MERGED: '' }[status] || '');
  const fmtMs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`);
  const pct = (value) => (value == null || Number.isNaN(value) ? '—' : `${Math.round(value * 100)}%`);

  function readPref(key, fallback) {
    try { const value = localStorage.getItem(key); return value == null ? fallback : JSON.parse(value); } catch (_) { return fallback; }
  }
  function writePref(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* preferences are optional */ }
  }

  const ui = {
    spec: null,
    engine: null,
    currentId: null,
    currentProject: null,
    tab: 'results',
    progress: new Map(),
    renderTimer: null
  };

  // ---- transport routing -----------------------------------------------------------------
  let simulator = null;
  let chromeTransport = null;
  // The engine passes the executing project's own transport mode with every dispatch.
  const routerTransport = {
    dispatch: (args) => ((args.mode === 'simulator' || !chromeTransport) ? simulator : chromeTransport).dispatch(args),
    cancel: async () => { await simulator?.cancel(); await chromeTransport?.cancel(); }
  };

  function scheduleRender() {
    clearTimeout(ui.renderTimer);
    ui.renderTimer = setTimeout(() => { render().catch((error) => console.error('[AutomationLab] render failed', error)); }, 60);
  }

  // ---- boot ------------------------------------------------------------------------------
  async function boot() {
    buildModelChoices();
    $('simulatorToggle').checked = readPref('automationLab.simulator', !root.chrome?.runtime?.id);
    $('simulatorToggle').addEventListener('change', (event) => writePref('automationLab.simulator', event.target.checked));
    try {
      ui.spec = await root.AlSpec.loadFromFetch('automation-spec/');
    } catch (error) {
      showLint(`Спецификация не загружена: ${error.message}`);
      return;
    }
    $('specBadge').textContent = `spec v${ui.spec.version}${ui.spec.ok ? '' : ' · lint ✗'}`;
    $('specBadge').className = `badge ${ui.spec.ok ? 'ok' : 'err'}`;
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
    simulator = root.AlSimulator.createSimulatorTransport({ latencyMs: 350 });
    if (root.chrome?.runtime?.id) {
      try {
        chromeTransport = root.AlTransport.createChromeTransport();
        chromeTransport.onProgress((progress) => { ui.progress.set(progress.model, progress); renderProgress(); });
      } catch (error) {
        console.warn('[AutomationLab] live transport unavailable', error);
      }
    }
    ui.engine = root.AlEngine.createEngine({
      spec: ui.spec,
      store,
      transport: routerTransport,
      onUpdate: () => scheduleRender(),
      log: (line) => console.info('[AutomationLab]', line)
    });
    await ui.engine.recover();
    wireControls();
    const projects = await ui.engine.listProjects();
    const last = readPref('automationLab.current', null);
    if (projects.some((project) => project.project_id === last)) await selectProject(last);
    await renderProjectList();
  }

  function showLint(message) {
    const banner = $('lintBanner');
    banner.textContent = message;
    banner.hidden = false;
  }

  function buildModelChoices() {
    const container = $('modelChoices');
    const saved = readPref('automationLab.models', DEFAULT_MODELS);
    MODELS.forEach((model) => {
      container.append(h('label', {}, h('input', { type: 'checkbox', value: model, checked: saved.includes(model) }), model));
    });
    container.addEventListener('change', syncPrimary);
    syncPrimary();
  }

  function selectedModels() {
    return [...$('modelChoices').querySelectorAll('input:checked')].map((input) => input.value);
  }

  function syncPrimary() {
    const select = $('primarySelect');
    const models = selectedModels();
    const previous = select.value || readPref('automationLab.primary', models[0]);
    select.replaceChildren(...models.map((model) => h('option', { value: model, selected: model === previous }, model)));
  }

  function wireControls() {
    $('newProjectForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const models = selectedModels();
      if (models.length < 2) { alert('Выберите минимум 2 модели: стадии 2 и 5 требуют независимых ответов разных моделей.'); return; }
      writePref('automationLab.models', models);
      writePref('automationLab.primary', $('primarySelect').value);
      const simulatorMode = $('simulatorToggle').checked || !chromeTransport;
      const projectId = await ui.engine.createProject({
        ideaText: $('ideaInput').value,
        models,
        primaryModel: $('primarySelect').value,
        timeoutMs: Number($('timeoutInput').value) * 1000,
        transportMode: simulatorMode ? 'simulator' : 'live'
      });
      $('ideaInput').value = '';
      await selectProject(projectId);
      await renderProjectList();
      startRun();
    });
    $('runBtn').addEventListener('click', startRun);
    $('stopBtn').addEventListener('click', async () => { await ui.engine.stop(); scheduleRender(); });
    $('retryBtn').addEventListener('click', async () => { await ui.engine.retry(ui.currentId); startRun(); });
    $('deleteBtn').addEventListener('click', async () => {
      if (!ui.currentId || !confirm('Удалить проект и всё его состояние?')) return;
      await ui.engine.deleteProject(ui.currentId);
      ui.currentId = null;
      ui.currentProject = null;
      writePref('automationLab.current', null);
      $('projectView').hidden = true;
      $('emptyView').hidden = false;
      await renderProjectList();
    });
    $('exportJsonBtn').addEventListener('click', exportJson);
    $('exportMdBtn').addEventListener('click', exportMarkdown);
    document.querySelectorAll('.tabs button').forEach((button) => button.addEventListener('click', () => {
      ui.tab = button.dataset.tab;
      document.querySelectorAll('.tabs button').forEach((other) => other.setAttribute('aria-selected', String(other === button)));
      render().catch((error) => console.error('[AutomationLab] render failed', error));
    }));
  }

  function startRun() {
    if (!ui.currentId || ui.engine.isRunning()) return;
    ui.progress.clear();
    ui.engine.run(ui.currentId).catch((error) => { console.error(error); alert(`Ошибка запуска: ${error.message}`); }).finally(scheduleRender);
    scheduleRender();
  }

  async function selectProject(projectId) {
    ui.currentId = projectId;
    writePref('automationLab.current', projectId);
    $('projectView').hidden = false;
    $('emptyView').hidden = true;
    await render();
  }

  async function renderProjectList() {
    const projects = await ui.engine.listProjects();
    $('projectList').replaceChildren(...(projects.length ? projects.map((project) => {
      const [label] = STATE_LABELS[project.workflow_state] || [project.workflow_state];
      return h('li', {}, h('button', { type: 'button', 'aria-current': String(project.project_id === ui.currentId), onclick: async () => { await selectProject(project.project_id); await renderProjectList(); } },
        h('span', {}, project.title),
        h('small', {}, `${label} · ${project.config?.transport === 'simulator' ? 'симулятор' : 'веб-модели'} · ${new Date(project.created_at).toLocaleString()}`)));
    }) : [h('li', { class: 'muted' }, 'Проектов пока нет')]));
  }

  // ---- rendering -------------------------------------------------------------------------
  async function render() {
    if (!ui.currentId || !ui.engine) return;
    const state = await ui.engine.getState(ui.currentId);
    if (!state) return;
    ui.currentProject = state.project;
    const { project } = state;
    const [label, tone] = STATE_LABELS[project.workflow_state] || [project.workflow_state, ''];
    const running = ui.engine.isRunning();
    $('projectTitle').textContent = project.title;
    $('stateBadge').textContent = running && project.workflow_state !== 'WAITING_FOR_SELECTION' ? `${label} · стадия ${project.running_stage || project.next_stage}` : label;
    $('stateBadge').className = `badge ${tone}`;
    $('projectMeta').textContent = `${project.project_id} · ${project.config.transport === 'simulator' ? 'симулятор' : 'веб-модели'} · модели: ${project.config.models.join(', ')} · основная: ${project.config.primary} · rev ${project.revision}`;
    $('runBtn').disabled = running || !['READY', 'PAUSED'].includes(project.workflow_state);
    $('runBtn').textContent = project.workflow_state === 'PAUSED' ? 'Продолжить' : 'Запустить';
    $('stopBtn').disabled = !running;
    $('retryBtn').hidden = project.workflow_state !== 'STAGE_FAILED';
    $('retryBtn').disabled = running;

    renderStageTrack(state);
    renderProgress();
    const errorPanel = $('errorPanel');
    errorPanel.hidden = project.workflow_state !== 'STAGE_FAILED';
    if (!errorPanel.hidden) {
      const error = project.last_error || {};
      errorPanel.replaceChildren(h('strong', {}, `Стадия ${error.stage}: ${error.code}. `), error.message || '', h('br'),
        h('span', {}, 'Проверьте вкладку «Вызовы» (промпт и сырой ответ каждой попытки) и нажмите «Повторить стадию». Состояние проекта не изменено.'));
    }
    renderOwnerPanel(state);
    ['results', 'registry', 'calls', 'telemetry', 'events'].forEach((name) => { $(`tab${name[0].toUpperCase()}${name.slice(1)}`).hidden = ui.tab !== name; });
    if (ui.tab === 'results') renderResults(state);
    if (ui.tab === 'registry') renderRegistry(state);
    if (ui.tab === 'calls') renderCalls(state);
    if (ui.tab === 'telemetry') renderTelemetry(state);
    if (ui.tab === 'events') renderEvents(state);
    if (!running) renderProjectList();
  }

  function renderStageTrack(state) {
    const { project, execs, calls } = state;
    $('stageTrack').replaceChildren(...ui.spec.pilotStages.map((n) => {
      const stage = ui.spec.stage(n);
      const stageExecs = execs.filter((exec) => exec.stage === n);
      const exec = stageExecs[stageExecs.length - 1];
      let status = ['Ожидает', ''];
      if (exec?.status === 'COMMITTED') status = ['Зафиксирована', 'ok'];
      if (exec?.status === 'RUNNING') status = ui.engine.isRunning() && project.running_stage === n ? ['Выполняется', 'info'] : ['Прервана', 'warn'];
      if (exec?.status === 'FAILED') status = ['Не прошла', 'err'];
      if (project.workflow_state === 'WAITING_FOR_SELECTION' && project.wait?.resume_stage === n + 1 && exec?.status === 'COMMITTED') status = ['Ждёт владельца', 'warn'];
      const current = project.running_stage === n || (!ui.engine.isRunning() && project.next_stage === n);
      const execCalls = exec ? calls.filter((call) => exec.call_ids.includes(call.call_id)) : [];
      return h('li', { class: `stage-card${current ? ' current' : ''}` },
        h('span', { class: 'stage-no' }, `Стадия ${n}${stage.independent ? ' · независимая' : ''}`),
        h('span', { class: 'stage-title' }, stage.title),
        badge(status[0], status[1]),
        h('div', { class: 'stage-models' }, execCalls.map((call) => {
          const tone = { ACCEPTED: 'ok', COMMITTED: 'ok', FAILED: 'err', PENDING: 'info' }[call.status] || '';
          return badge(`${call.model} ${call.status === 'COMMITTED' || call.status === 'ACCEPTED' ? '✓' : call.status === 'FAILED' ? '✗' : '…'} ${call.attempts.length}`, tone);
        })));
    }));
  }

  function renderProgress() {
    const node = $('liveProgress');
    const running = ui.engine?.isRunning();
    node.hidden = !running || !ui.progress.size;
    node.replaceChildren(...[...ui.progress.values()].map((item) => badge(`${item.model}: ${item.terminal ? 'готово' : 'генерация'} · ${item.chars} симв.`, item.terminal ? 'ok' : 'info')));
  }

  function renderOwnerPanel(state) {
    const { project, latest } = state;
    const panel = $('ownerPanel');
    const waiting = project.workflow_state === 'WAITING_FOR_SELECTION' && project.wait;
    panel.hidden = !waiting;
    if (!waiting) return;
    const byId = new Map(latest.map((entry) => [entry.object_id, entry]));
    const form = $('ownerForm');
    const previous = new FormData(form);
    const questions = project.wait.qst_ids.map((id) => byId.get(id)).filter((qst) => qst && ['READY', 'ASKED'].includes(qst.status));
    form.replaceChildren(...questions.map((qst) => {
      const subject = qst.payload.decision_ref ? byId.get(qst.payload.decision_ref.object_id) : null;
      const multi = qst.payload.input_type === 'MULTI';
      return h('fieldset', { class: 'question' },
        h('p', {}, qst.payload.question),
        h('span', { class: 'meta' }, `${qst.object_id} · класс ${qst.payload.authority_class}${subject ? ` · ${subject.object_id}` : ''}${qst.payload.required ? ' · обязательный' : ''}`),
        subject?.code === 'DPL' ? dplSummary(subject) : null,
        subject?.code === 'PD' ? h('span', { class: 'meta' }, `Решение: ${subject.payload.question}`) : null,
        qst.payload.options.map((option) => h('label', {},
          h('input', { type: multi ? 'checkbox' : 'radio', name: qst.object_id, value: option.option_id, required: !multi && qst.payload.required, checked: previous.getAll(qst.object_id).includes(option.option_id) }),
          h('span', {}, option.label, h('br'), h('span', { class: 'meta' }, option.effects.map((effect) => `${effect.effect_type}${effect.value != null && effect.effect_type !== 'ACTIVATE_DPL' ? `: ${effect.value}` : ''}`).join(' · '))))));
    }), h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary' }, 'Применить выбор и продолжить')));
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const answers = Object.fromEntries(questions.map((qst) => [qst.object_id, data.getAll(qst.object_id)]));
      try {
        await ui.engine.answer(ui.currentId, answers);
        startRun();
      } catch (error) {
        alert(`Ответ не принят: ${error.message}`);
      }
    };
  }

  function dplSummary(dpl) {
    const rules = dpl.payload.authority_rules || [];
    return h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Класс'), h('th', {}, 'Режим'), h('th', {}, 'Макс. риск'), h('th', {}, 'Виды решений'))),
      h('tbody', {}, rules.map((rule) => h('tr', {}, h('td', {}, rule.authority_class), h('td', {}, rule.mode), h('td', {}, rule.max_risk), h('td', {}, (rule.decision_kinds || []).join(', ')))))),
    h('p', { class: 'meta' }, `Автономия после G1: ${Object.values(dpl.payload.post_g1_autonomy || {}).join(' · ')}`));
  }

  const refText = (ref) => (ref && ref.object_id ? ref.object_id : '');
  function objCard(entry, body, wide = false) {
    return h('article', { class: `obj-card${wide ? ' wide' : ''}` },
      h('header', {}, h('span', { class: 'obj-id' }, `${entry.object_id} v${entry.version} · стадия ${entry.created_stage}`), badge(entry.status, statusTone(entry.status))),
      body);
  }

  function renderResults(state) {
    const { latest, project } = state;
    const live = latest.filter((entry) => entry.status !== 'SUPERSEDED');
    const of = (code) => live.filter((entry) => entry.code === code);
    const section = (code, cards) => (cards.length ? [h('h3', {}, `${CODE_LABELS[code] || code} (${cards.length})`), h('div', { class: 'card-list' }, cards)] : []);
    const idea = of('IDEA')[0];
    const pcon = of('PCON')[0];
    const blocks = [];
    if (project.workflow_state === 'PILOT_COMPLETE') blocks.push(h('div', { class: 'banner banner-info' }, 'Стадии 1–5 завершены. Концепция продукта и находки независимого ревью ниже; следующая стадия фреймворка — 6 (Delta Decision Closure).'));
    if (pcon) {
      blocks.push(h('h3', {}, 'Концепция продукта (PCON)'), h('div', { class: 'card-list' }, objCard(pcon, [
        h('p', {}, pcon.payload.summary),
        h('p', { class: 'muted' }, `Акторы: ${(pcon.payload.actors || []).join(', ')}`),
        listBlock('Сценарии', pcon.payload.scenarios), listBlock('Скоуп', pcon.payload.scope), listBlock('Правила и открытые вопросы', pcon.payload.rules)
      ], true)));
    }
    const severityRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    blocks.push(...section('FND', of('FND').sort((a, b) => severityRank[a.payload.severity] - severityRank[b.payload.severity]).map((entry) => objCard(entry, [
      h('p', {}, badge(entry.payload.severity, entry.payload.severity === 'HIGH' || entry.payload.severity === 'CRITICAL' ? 'err' : 'warn'), ' ', h('strong', {}, entry.payload.class)),
      h('p', {}, entry.payload.description), h('p', { class: 'muted' }, `→ ${entry.payload.proposed_route}`)]))));
    blocks.push(...section('PD', of('PD').map((entry) => objCard(entry, [
      h('p', {}, h('strong', {}, entry.payload.question)),
      h('p', {}, entry.payload.decision ? `Решение: ${entry.payload.decision}` : h('span', { class: 'muted' }, 'Решение не принято')),
      h('p', { class: 'muted' }, `${entry.authority_class || '—'} · ${entry.payload.decided_by}`)]))));
    blocks.push(...section('DPL', of('DPL').map((entry) => objCard(entry, dplSummary(entry), true))));
    blocks.push(...section('PRP', of('PRP').map((entry) => objCard(entry, [
      h('p', {}, h('strong', {}, entry.payload.kind), ` · ${entry.payload.source_model}`), h('p', {}, entry.payload.statement), h('p', { class: 'muted' }, entry.payload.rationale)]))));
    blocks.push(...section('UNK', of('UNK').map((entry) => objCard(entry, [h('p', {}, entry.payload.question), h('p', { class: 'muted' }, `маршрут: ${entry.payload.route}${entry.blocking ? ' · блокирующий' : ''}`)]))));
    blocks.push(...section('ASM', of('ASM').map((entry) => objCard(entry, [h('p', {}, entry.payload.statement), h('p', { class: 'muted' }, `нужно: ${entry.payload.needed_evidence}`)]))));
    blocks.push(...section('RSK', of('RSK').map((entry) => objCard(entry, [h('p', {}, entry.payload.failure_class), h('p', { class: 'muted' }, `${entry.payload.likelihood}/${entry.payload.impact} · ${entry.payload.mitigation}`)]))));
    blocks.push(...section('QST', of('QST').map((entry) => {
      const answer = live.find((item) => item.code === 'QANS' && item.payload.question_ref.object_id === entry.object_id);
      const chosen = answer ? entry.payload.options.filter((option) => answer.payload.selected_option_ids.includes(option.option_id)).map((option) => option.label).join(', ') : null;
      return objCard(entry, [h('p', {}, entry.payload.question), h('p', { class: 'muted' }, chosen ? `Выбрано: ${chosen}` : 'Ожидает ответа')]);
    })));
    if (idea) blocks.push(h('h3', {}, 'Исходная идея'), h('div', { class: 'card-list' }, objCard(idea, h('p', {}, idea.payload.raw_text), true)));
    $('tabResults').replaceChildren(...blocks);
  }

  function listBlock(title, items) {
    if (!items?.length) return null;
    return h('div', {}, h('span', { class: 'muted' }, title), h('ul', {}, items.map((item) => h('li', {}, item))));
  }

  function openText(title, text) {
    $('textDialogTitle').textContent = title;
    $('textDialogBody').textContent = text == null ? '—' : text;
    $('textDialog').showModal();
  }

  function renderRegistry(state) {
    const versions = new Map();
    state.records.forEach((record) => versions.set(record.object_id, (versions.get(record.object_id) || 0) + 1));
    $('tabRegistry').replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['ID', 'Тип', 'Версия', 'Статус', 'Класс', 'Стадия', 'Создан прогоном', 'content_hash', ''].map((title) => h('th', {}, title)))),
      h('tbody', {}, state.latest.map((entry) => h('tr', {},
        h('td', {}, h('code', {}, entry.object_id)), h('td', {}, entry.code), h('td', { class: 'num' }, `${entry.version}${versions.get(entry.object_id) > 1 ? ` (${versions.get(entry.object_id)})` : ''}`),
        h('td', {}, badge(entry.status, statusTone(entry.status))), h('td', {}, entry.authority_class || '—'), h('td', { class: 'num' }, entry.created_stage),
        h('td', {}, h('code', {}, entry.created_by_run)), h('td', {}, h('code', {}, entry.content_hash.slice(0, 12))),
        h('td', {}, h('button', { type: 'button', onclick: () => openText(`${entry.object_id} v${entry.version}`, JSON.stringify(entry, null, 2)) }, 'JSON'))))))));
  }

  const OUTCOME_TONES = { ACCEPTED: 'ok', REPAIRABLE: 'warn', REJECTED: 'err', TRANSPORT_FAILED: 'err', INTERRUPTED: 'warn' };

  function attemptRow(call, attempt, index) {
    const viewers = [
      h('button', { type: 'button', onclick: () => openText(`Промпт · ${call.model} · ${attempt.attempt_id}`, attempt.prompt_text) }, 'Промпт'),
      h('button', { type: 'button', onclick: () => openText(`Сырой ответ · ${call.model} · ${attempt.attempt_id}`, attempt.raw_text) }, 'Ответ')
    ];
    if (attempt.context_audit) {
      viewers.push(h('button', { type: 'button', onclick: () => openText(`ContextAssemblyAudit · ${attempt.attempt_id}`, JSON.stringify(attempt.context_audit, null, 2)) }, 'Аудит'));
    }
    const errors = (attempt.errors || []).slice(0, 4).map((error) => h('div', {}, h('code', {}, error.code), ` ${error.message}`));
    return h('tr', {},
      h('td', {}, index === 0 ? [call.model, ' ', badge(call.status, statusTone(call.status))] : ''),
      h('td', {}, `${index + 1} · ${attempt.kind}`),
      h('td', {}, badge(attempt.outcome || attempt.status, OUTCOME_TONES[attempt.outcome] || 'info')),
      h('td', {}, attempt.extraction_mode || '—'),
      h('td', { class: 'num' }, fmtMs(attempt.duration_ms)),
      h('td', { class: 'num' }, attempt.prompt_chars ?? '—'),
      h('td', {}, errors),
      h('td', {}, h('div', { class: 'actions' }, viewers)));
  }

  function renderCalls(state) {
    const blocks = state.execs.slice().reverse().map((exec) => {
      const execCalls = state.calls.filter((call) => exec.call_ids.includes(call.call_id));
      const rows = execCalls.flatMap((call) => call.attempts.map((attempt, index) => attemptRow(call, attempt, index)));
      const head = h('thead', {}, h('tr', {}, ['Модель', 'Попытка', 'Итог', 'Извлечение', 'Длит.', 'Промпт', 'Ошибки', ''].map((title) => h('th', {}, title))));
      return h('section', { class: 'panel' },
        h('h2', {}, `Стадия ${exec.stage} · ${exec.exec_id} `, badge(exec.status, statusTone(exec.status))),
        h('p', { class: 'muted mono' }, `snapshot ${exec.snapshot_id} · hash ${exec.input_snapshot_hash}`),
        exec.failure ? h('p', { class: 'banner banner-error' }, `${exec.failure.code}: ${exec.failure.message}`) : null,
        h('div', { class: 'table-wrap' }, h('table', {}, head, h('tbody', {}, rows))));
    });
    $('tabCalls').replaceChildren(...(blocks.length ? blocks : [h('p', { class: 'muted' }, 'Вызовов ещё не было.')]));
  }

  function telemetry(state) {
    const byModel = new Map();
    const quantile = (values, q) => {
      if (!values.length) return null;
      const sorted = values.slice().sort((a, b) => a - b);
      return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    };
    state.calls.forEach((call) => {
      const row = byModel.get(call.model) || { model: call.model, calls: 0, attempts: 0, firstPass: 0, repairs: 0, repairOk: 0, accepted: 0, extractFail: 0, schemaFail: 0, hashMismatch: 0, durations: [], modes: {} };
      row.calls += 1;
      if (call.attempts[0]?.outcome === 'ACCEPTED') row.firstPass += 1;
      if (call.status === 'ACCEPTED' || call.status === 'COMMITTED') row.accepted += 1;
      call.attempts.forEach((attempt, index) => {
        row.attempts += 1;
        if (attempt.duration_ms != null) row.durations.push(attempt.duration_ms);
        if (attempt.extraction_mode) row.modes[attempt.extraction_mode] = (row.modes[attempt.extraction_mode] || 0) + 1;
        if (attempt.extraction_mode === 'FAILED') row.extractFail += 1;
        if ((attempt.errors || []).some((error) => error.code === 'AL_STRUCT_SCHEMA' || error.code === 'OBJECT_SCHEMA')) row.schemaFail += 1;
        if ((attempt.errors || []).some((error) => error.code === 'SNAPSHOT_HASH_MISMATCH')) row.hashMismatch += 1;
        if (attempt.kind === 'repair') { row.repairs += 1; if (attempt.outcome === 'ACCEPTED') row.repairOk += 1; }
        void index;
      });
      byModel.set(call.model, row);
    });
    return [...byModel.values()].map((row) => ({
      ...row,
      median: quantile(row.durations, 0.5),
      p95: quantile(row.durations, 0.95)
    }));
  }

  function renderTelemetry(state) {
    const rows = telemetry(state);
    const totals = rows.reduce((acc, row) => ({ calls: acc.calls + row.calls, attempts: acc.attempts + row.attempts, repairs: acc.repairs + row.repairs }), { calls: 0, attempts: 0, repairs: 0 });
    const fanoutCalls = state.calls.filter((call) => ui.spec.stage(call.stage)?.independent).length;
    const created = state.events.find((event) => event.event_type === 'PROJECT_CREATED');
    const lastCommit = [...state.events].reverse().find((event) => event.event_type === 'STAGE_RUN_COMMITTED');
    const wall = created && lastCommit ? Date.parse(lastCommit.at) - Date.parse(created.at) : null;
    $('tabTelemetry').replaceChildren(
      h('p', { class: 'muted' }, `Измерено (runtime/cost-telemetry): вызовов моделей ${totals.calls}, попыток ${totals.attempts}, ремонтов ${totals.repairs}, fan-out вызовов ${fanoutCalls}, wall-clock до последней фиксации ${fmtMs(wall)} (включая ожидание владельца).`),
      h('div', { class: 'table-wrap' }, h('table', {},
        h('thead', {}, h('tr', {}, ['Провайдер', 'Вызовы', 'Попытки', 'С первого раза', 'Ремонт → успех', 'Принято', 'Сбой извлечения', 'Сбой схемы', 'Хеш снимка ≠', 'Медиана', 'p95', 'Режимы извлечения'].map((title) => h('th', {}, title)))),
        h('tbody', {}, rows.map((row) => h('tr', {},
          h('td', {}, row.model), h('td', { class: 'num' }, row.calls), h('td', { class: 'num' }, row.attempts),
          h('td', { class: 'num' }, pct(row.firstPass / row.calls)), h('td', { class: 'num' }, row.repairs ? `${row.repairOk}/${row.repairs}` : '—'),
          h('td', { class: 'num' }, pct(row.accepted / row.calls)), h('td', { class: 'num' }, pct(row.extractFail / row.attempts)),
          h('td', { class: 'num' }, pct(row.schemaFail / row.attempts)), h('td', { class: 'num' }, pct(row.hashMismatch / row.attempts)),
          h('td', { class: 'num' }, fmtMs(row.median)), h('td', { class: 'num' }, fmtMs(row.p95)),
          h('td', {}, Object.entries(row.modes).map(([mode, count]) => `${mode}×${count}`).join(', ') || '—')))))));
  }

  function renderEvents(state) {
    $('tabEvents').replaceChildren(h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['#', 'Время', 'Событие', 'rev', 'Данные'].map((title) => h('th', {}, title)))),
      h('tbody', {}, state.events.slice().reverse().map((event) => h('tr', {},
        h('td', { class: 'num' }, event.event_id), h('td', {}, new Date(event.at).toLocaleTimeString()), h('td', {}, event.event_type), h('td', { class: 'num' }, event.project_revision),
        h('td', {}, h('details', {}, h('summary', {}, summarizeEvent(event)), h('pre', {}, JSON.stringify(event.payload, null, 2))))))))));
  }

  function summarizeEvent(event) {
    const p = event.payload || {};
    if (event.event_type === 'STAGE_RUN_COMMITTED') return `стадия ${p.stage}: создано ${p.created?.length || 0}, статусов изменено ${p.status_changes?.length || 0}`;
    if (event.event_type === 'ROUTED') return `${p.workflow_state}${p.next_stage ? ` → стадия ${p.next_stage}` : ''}`;
    if (event.event_type === 'STAGE_FAILED') return `стадия ${p.stage}: ${p.code}`;
    if (event.event_type === 'ANSWERS_COMPILED') return `эффектов применено: ${p.applied?.length || 0}`;
    return Object.keys(p).join(', ');
  }

  // ---- export ----------------------------------------------------------------------------
  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = h('a', { href: url, download: name });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
    if (of('FND').length) lines.push('## Находки независимого ревью', '', '| ID | Серьёзность | Класс | Описание |', '|---|---|---|---|', ...of('FND').map((e) => `| ${e.object_id} | ${e.payload.severity} | ${e.payload.class} | ${String(e.payload.description).replace(/\|/g, '\\|').replace(/\n/g, ' ')} |`), '');
    if (of('PD').length) lines.push('## Решения', '', '| ID | Статус | Класс | Вопрос | Решение | Кем |', '|---|---|---|---|---|---|', ...of('PD').map((e) => `| ${e.object_id} | ${e.status} | ${e.authority_class || ''} | ${String(e.payload.question).replace(/\|/g, '\\|')} | ${String(e.payload.decision ?? '—').replace(/\|/g, '\\|')} | ${e.payload.decided_by} |`), '');
    const dpl = of('DPL').find((e) => e.status === 'ACTIVE');
    if (dpl) lines.push('## Decision Policy', '', '| Класс | Режим | Макс. риск |', '|---|---|---|', ...dpl.payload.authority_rules.map((r) => `| ${r.authority_class} | ${r.mode} | ${r.max_risk} |`), '');
    if (of('UNK').length) lines.push('## Открытые неизвестные', '', ...of('UNK').map((e) => `- ${e.payload.question} (${e.payload.route})`), '');
    if (of('RSK').length) lines.push('## Риски', '', ...of('RSK').map((e) => `- ${e.payload.failure_class}: ${e.payload.likelihood}/${e.payload.impact} — ${e.payload.mitigation}`), '');
    return lines.join('\n');
  }

  root.AutomationLab = Object.freeze({ buildMarkdown, telemetry });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { boot().catch((error) => showLint(`Ошибка запуска: ${error.message}`)); });
  else boot().catch((error) => showLint(`Ошибка запуска: ${error.message}`));
})(window);
