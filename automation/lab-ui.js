// Automation — page controller. Layout of automation_prototype_v2.2.3.html. State lives in memory
// only: a reload starts clean and cancels a running batch. A live snapshot is mirrored to
// chrome.storage.session for the Automation tab of the telemetry window.
(function initAutomation(root) {
  'use strict';

  const MODELS = ['GPT', 'Claude', 'Qwen', 'Z.ai', 'Kimi', 'Gemini', 'Grok', 'DeepSeek', 'Le Chat', 'Perplexity'];
  const MAX_MODELS = 4;
  const STAGE_NAMES = { 1: 'Идея и правила', 2: 'Расширение', 3: 'Решения', 4: 'Концепция', 5: 'Ревью' };
  const LIVE_KEY = 'automationLab.live';

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
  const pref = (key, fallback) => { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (_) { return fallback; } };
  const setPref = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* optional */ } };

  const ui = { spec: null, engine: null, projectId: null, state: null, models: pref('automationLab.models', ['GPT', 'Claude']).filter((m) => MODELS.includes(m)).slice(0, MAX_MODELS), tab: {}, progress: new Map(), timer: null };
  let simulator = null;
  let live = null;
  const transport = {
    dispatch: (args) => (args.mode === 'simulator' || !live ? simulator : live).dispatch(args),
    cancel: async () => { await simulator?.cancel(); await live?.cancel(); }
  };
  const running = () => Boolean(ui.engine?.isRunning());
  const models = () => ui.state?.project?.config?.models || ui.models;

  function newEngine() {
    ui.engine = root.AlEngine.createEngine({
      spec: ui.spec,
      store: root.AlStore.createMemoryStore(),
      transport,
      onUpdate: (_id, kind) => { if (kind === 'dispatch') ui.progress.clear(); schedule(); }
    });
    ui.projectId = null;
    ui.state = null;
  }

  function schedule(delay = 80) {
    clearTimeout(ui.timer);
    ui.timer = setTimeout(() => { render().catch((error) => console.error('[Automation]', error)); }, delay);
  }

  // ---- model bar ---------------------------------------------------------------------------
  function renderNav() {
    const selected = models();
    $('modelNav').replaceChildren(...MODELS.map((model) => {
      const index = selected.indexOf(model);
      return h('button', { type: 'button', class: `model-nav-button${index >= 0 ? ' is-active' : ''}`, title: model, disabled: Boolean(ui.projectId), onclick: () => toggle(model) },
        h('span', { class: 'model-nav-icon', style: `--model-icon:url('${root.AlModelIcons[model]}')` }),
        h('span', { class: 'model-nav-label' }, model),
        h('span', { class: 'model-nav-role' }, index === 0 ? 'модератор' : ''));
    }));
  }

  function toggle(model) {
    if (ui.projectId) return;
    if (ui.models.includes(model)) ui.models = ui.models.filter((m) => m !== model);
    else if (ui.models.length < MAX_MODELS) ui.models.push(model);
    setPref('automationLab.models', ui.models);
    render();
  }

  // ---- actions -----------------------------------------------------------------------------
  async function start(event) {
    event.preventDefault();
    const idea = $('ideaInput').value.trim();
    if (!idea || ui.projectId) return;
    if (ui.models.length < 2) { $('centerStatus').textContent = 'нужно минимум 2 модели'; return; }
    const sim = $('simToggle').checked || !live;
    ui.projectId = await ui.engine.createProject({ ideaText: idea, models: ui.models, primaryModel: ui.models[0], transportMode: sim ? 'simulator' : 'live' });
    $('ideaInput').value = '';
    run();
  }

  function run() {
    ui.engine.run(ui.projectId).catch((error) => console.error('[Automation]', error)).finally(() => schedule());
    schedule();
  }

  async function reset() {
    if (running()) await ui.engine.stop();
    newEngine();
    ui.tab = {};
    ui.progress.clear();
    publish(null);
    render();
  }

  // ---- render ------------------------------------------------------------------------------
  async function render() {
    ui.state = ui.projectId ? await ui.engine.getState(ui.projectId) : null;
    const project = ui.state?.project;
    renderNav();
    renderColumns();
    renderCenter();
    const done = project?.workflow_state === 'PILOT_COMPLETE';
    $('resultsBtn').disabled = !done;
    $('saveBtn').disabled = !done;
    $('resetBtn').textContent = running() ? 'Stop' : 'Cancel';
    $('sendBtn').disabled = Boolean(project);
    $('ideaInput').disabled = Boolean(project);
    const diagnosis = ui.state ? root.AlDiagnostics.diagnose(ui.state, { spec: ui.spec }) : null;
    $('diagDot').hidden = !diagnosis?.problems.some((p) => p.severity === 'critical');
    if (!$('resultsModal').hidden && $('reportBtn').hidden === false) renderDiagnostics();
    publish(ui.state);
  }

  function centerStatus(project) {
    if (!project) return '';
    if (project.workflow_state === 'WAITING_FOR_SELECTION') return 'ждёт вашего решения';
    if (project.workflow_state === 'PILOT_COMPLETE') return 'готово';
    if (project.workflow_state === 'STAGE_FAILED') return `стадия ${project.last_error?.stage} не прошла`;
    if (running()) return `стадия ${project.running_stage || project.next_stage}`;
    return 'пауза';
  }

  const answerOf = (call) => {
    const c = call?.accepted?.canonical;
    if (!c) return '';
    const text = (c.outputs || []).map((o) => o.content).filter(Boolean).join('\n\n');
    return text || (c.completion?.empty_by_design ? 'Замечаний нет.' : '');
  };
  const failText = (attempt) => {
    const e = (attempt.errors || [])[0];
    if (!e) return attempt.outcome;
    return root.AlDiagnostics.explain(e.class === 'TRANSPORT' && /TIMEOUT/.test(e.code) ? 'TIMEOUT' : e.code, '').title;
  };
  const thinking = (model) => {
    const chars = ui.progress.get(model)?.chars;
    return h('div', { class: 'msg' }, h('div', { class: 'msg-head' }, model),
      h('div', { class: 'thinking' }, h('span', {}, chars ? `формирует ответ · ${chars}` : 'формирует ответ'), h('span', { class: 'dot' }), h('span', { class: 'dot' }), h('span', { class: 'dot' })));
  };

  function structure(c, call) {
    const tmp = call.tmp_map || {};
    const row = (k, v, cls = '') => h('div', { class: 'structure-row' }, h('div', { class: 'structure-key' }, k), h('div', { class: `structure-val ${cls}` }, v));
    const n = Number(c.completion?.output_count || 0);
    return h('div', { class: 'structure' },
      row('Snapshot', c.passport?.input_snapshot_id || '—'),
      row('Inputs', (c.passport?.input_refs || []).map((r) => `${r.object_id} · v${r.version}`).join(' · ') || '—'),
      row('Output', (c.outputs || []).map((o) => `${o.id} · ${o.type}`).join(' · ') || '—'),
      row('Annotations', h('span', { class: 'tags' }, (c.annotations || []).length ? c.annotations.map((a) => h('span', { class: 'tag' }, a.type)) : h('span', { class: 'tag' }, 'none'))),
      row('Changes', (c.changes || []).map((ch) => `${ch.op} · ${ch.object_type}${tmp[ch.temp_id] ? ` · ${tmp[ch.temp_id].object_id}` : ''}`).join(' · ') || '—'),
      row('Completion', `${c.completion?.status || '—'} · ${n} output${n === 1 ? '' : 's'}`, 'completion'));
  }

  function keepScroll(node, build) {
    const bottom = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
    const top = node.scrollTop;
    build();
    node.scrollTop = bottom ? node.scrollHeight : top;
  }

  function renderColumns() {
    const list = models();
    const sides = { left: list.filter((_, i) => i % 2 === 0), right: list.filter((_, i) => i % 2 === 1) };
    ['left', 'right'].forEach((side) => {
      const own = sides[side];
      if (!own.includes(ui.tab[side])) ui.tab[side] = own[0] || null;
      const model = ui.tab[side];
      $(`${side}Tabs`).replaceChildren(...(own.length ? own.map((m) => h('button', { type: 'button', class: 'col-tab', 'aria-selected': String(m === model), onclick: () => { ui.tab[side] = m; renderColumns(); } }, m)) : [h('h2', {}, side === 'left' ? 'Model A' : 'Model B')]));
      const calls = (ui.state?.calls || []).filter((call) => call.model === model);
      let sending = null;
      let status = 'ожидание';
      keepScroll($(`${side}Chat`), () => {
        $(`${side}Chat`).replaceChildren(...ui.spec.pilotStages.map((n) => {
          const items = [];
          calls.filter((call) => call.stage === n).forEach((call) => call.attempts.forEach((attempt) => {
            items.push(h('div', { class: 'msg user' }, h('div', { class: 'msg-head' }, 'Moderator'), h('div', { class: 'bubble long' }, attempt.prompt_text || '')));
            if (attempt.status === 'DISPATCHED') { sending = attempt.prompt_text; status = ui.progress.get(model)?.chars ? 'генерация' : 'получает запрос'; items.push(thinking(model)); }
            else if (call.accepted?.attempt_id === attempt.attempt_id) { status = 'принят'; items.push(h('div', { class: 'msg' }, h('div', { class: 'msg-head' }, model), h('div', { class: 'bubble' }, answerOf(call), structure(call.accepted.canonical, call)))); }
            else if (attempt.outcome) { status = 'ошибка'; items.push(h('div', { class: 'msg fail' }, h('div', { class: 'msg-head' }, model), h('div', { class: 'bubble' }, failText(attempt)))); }
          }));
          return items.length ? h('section', { class: 'round' }, h('div', { class: 'round-title' }, `${n} · ${STAGE_NAMES[n]}`), items) : null;
        }).filter(Boolean));
      });
      $(`${side}Status`).textContent = model ? status : '';
      $(`${side}Request`).className = sending ? 'request-view sending' : 'request-view empty';
      $(`${side}Request`).textContent = sending || '';
    });
  }

  function renderCenter() {
    const chat = $('centerChat');
    const state = ui.state;
    $('centerStatus').textContent = centerStatus(state?.project);
    if (!state) { chat.replaceChildren(); return; }
    const { project, execs, calls, latest } = state;
    const byId = new Map(latest.map((e) => [e.object_id, e]));
    const form = chat.querySelector('form');
    const picked = form ? new FormData(form) : null;
    keepScroll(chat, () => {
      chat.replaceChildren(...ui.spec.pilotStages.map((n) => {
        const items = [];
        if (n === 1) items.push(h('div', { class: 'msg user' }, h('div', { class: 'msg-head' }, 'Moderator'), h('div', { class: 'bubble' }, byId.get('IDEA-0001')?.payload.raw_text || '')));
        const exec = execs.filter((e) => e.stage === n).at(-1);
        if (!exec && n > 1) return null;
        (exec ? calls.filter((c) => exec.call_ids.includes(c.call_id)) : []).forEach((call) => {
          if (call.accepted) items.push(h('div', { class: 'msg' }, h('div', { class: 'msg-head' }, call.model), h('div', { class: 'bubble' }, answerOf(call))));
          else if (call.attempts.some((a) => a.status === 'DISPATCHED')) items.push(thinking(call.model));
          else if (call.status === 'FAILED') items.push(h('div', { class: 'msg fail' }, h('div', { class: 'msg-head' }, call.model), h('div', { class: 'bubble' }, failText(call.attempts.at(-1)))));
        });
        if (project.workflow_state === 'STAGE_FAILED' && project.last_error?.stage === n) {
          items.push(h('div', { class: 'msg fail' }, h('div', { class: 'bubble' }, `${project.last_error.message || project.last_error.code}  `,
            h('button', { type: 'button', class: 'secondary', onclick: async () => { await ui.engine.retry(ui.projectId); run(); } }, 'Повторить'))));
        }
        if (project.workflow_state === 'WAITING_FOR_SELECTION' && project.wait?.resume_stage === n + 1) items.push(ask(project, byId, picked));
        return h('section', { class: 'round' }, h('div', { class: 'round-title' }, `${n} · ${STAGE_NAMES[n]}`), items);
      }).filter(Boolean));
      if (project.workflow_state === 'PILOT_COMPLETE') chat.append(h('div', { class: 'msg' }, h('div', { class: 'msg-head' }, 'Итог'), h('div', { class: 'bubble' }, summaryText(latest, 6))));
    });
  }

  function ask(project, byId, picked) {
    const questions = project.wait.qst_ids.map((id) => byId.get(id)).filter((q) => q && ['READY', 'ASKED'].includes(q.status));
    const form = h('form', { class: 'ask' }, questions.map((q) => h('fieldset', {},
      h('legend', {}, q.payload.session_id === 'DPL_APPROVAL' ? `Утвердить правила решений?\n${dplLine(byId.get(q.payload.decision_ref.object_id))}` : q.payload.question),
      q.payload.options.map((o) => h('label', {},
        h('input', { type: q.payload.input_type === 'MULTI' ? 'checkbox' : 'radio', name: q.object_id, value: o.option_id, required: q.payload.input_type !== 'MULTI', checked: picked?.getAll(q.object_id).includes(o.option_id) }),
        o.label)))),
    h('button', { type: 'submit', class: 'primary' }, 'Продолжить'));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      await ui.engine.answer(ui.projectId, Object.fromEntries(questions.map((q) => [q.object_id, data.getAll(q.object_id)])));
      run();
    });
    return form;
  }

  const dplLine = (dpl) => (dpl?.payload.authority_rules || []).map((r) => `${r.authority_class}: ${({ AUTO_POLICY: 'модели решают сами', REQUIRE_EVIDENCE: 'нужны доказательства', REQUIRE_OWNER_SELECTION: 'решаете вы', PROHIBITED: 'запрещено' })[r.mode] || r.mode}`).join(' · ');

  // ---- results / save / diagnostics ------------------------------------------------------------
  function summaryText(latest, limit = Infinity) {
    const live = latest.filter((e) => e.status !== 'SUPERSEDED');
    const pcon = live.find((e) => e.code === 'PCON');
    const rank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, INFO: 4 };
    const fnd = live.filter((e) => e.code === 'FND').sort((a, b) => rank[a.payload.severity] - rank[b.payload.severity]);
    const lines = [];
    if (pcon) lines.push(pcon.payload.summary);
    if (fnd.length) lines.push('', `Замечания (${fnd.length}):`, ...fnd.slice(0, limit).map((e) => `• ${e.payload.severity} — ${e.payload.description}`));
    return lines.join('\n');
  }

  function markdown(state) {
    const live = state.latest.filter((e) => e.status !== 'SUPERSEDED');
    const of = (code) => live.filter((e) => e.code === code);
    const pcon = of('PCON')[0];
    const out = [`# ${state.project.title}`, '', of('IDEA')[0]?.payload.raw_text || ''];
    if (pcon) {
      out.push('', '## Концепция', '', pcon.payload.summary);
      [['Акторы', pcon.payload.actors], ['Сценарии', pcon.payload.scenarios], ['Скоуп', pcon.payload.scope], ['Правила', pcon.payload.rules]].forEach(([t, items]) => { if (items?.length) out.push('', `### ${t}`, ...items.map((i) => `- ${i}`)); });
    }
    if (of('PD').length) out.push('', '## Решения', ...of('PD').map((e) => `- ${e.payload.question} — ${e.payload.decision ?? 'открыто'}`));
    if (of('FND').length) out.push('', '## Замечания ревью', ...of('FND').map((e) => `- ${e.payload.severity}: ${e.payload.description}`));
    return `${out.join('\n')}\n`;
  }

  function download(name, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function openModal(title, withReport) {
    $('modalTitle').textContent = title;
    $('reportBtn').hidden = !withReport;
    $('resultsModal').hidden = false;
  }

  function renderDiagnostics() {
    const body = $('modalBody');
    body.className = 'results-body ald-root';
    root.AlDiagnosticsView.render(body, ui.state, { spec: ui.spec });
  }

  function report() {
    const text = JSON.stringify(root.AlDiagnostics.buildReport(ui.state, { spec: ui.spec, extensionVersion: root.chrome?.runtime?.getManifest?.().version }), null, 2);
    download(`automation-report-${ui.state.project.project_id}.json`, text, 'application/json');
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  // Live mirror for the telemetry window (chrome.storage.session: cleared with the browser session
  // and reset whenever this page loads). Long texts are clipped.
  let publishTimer = null;
  function publish(state) {
    const storage = root.chrome?.storage?.session;
    if (!storage) return;
    clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      if (!state) { storage.remove(LIVE_KEY).catch?.(() => {}); return; }
      const clip = (t) => (typeof t === 'string' && t.length > 4000 ? `${t.slice(0, 4000)}…` : t);
      const slim = { ...state, records: [], calls: state.calls.map((c) => ({ ...c, attempts: c.attempts.map((a) => ({ ...a, prompt_text: clip(a.prompt_text), raw_text: clip(a.raw_text) })) })) };
      storage.set({ [LIVE_KEY]: slim }).catch?.(() => {});
    }, 500);
  }

  // ---- boot --------------------------------------------------------------------------------
  async function boot() {
    $('simToggle').checked = pref('automationLab.simulator', !root.chrome?.runtime?.id);
    $('simToggle').addEventListener('change', (e) => setPref('automationLab.simulator', e.target.checked));
    ui.spec = await root.AlSpec.loadFromFetch('automation-spec/');
    if (!ui.spec.ok) { $('centerStatus').textContent = 'спецификация не прошла проверку'; return; }
    simulator = root.AlSimulator.createSimulatorTransport({ latencyMs: 600 });
    if (root.chrome?.runtime?.id) {
      live = root.AlTransport.createChromeTransport();
      live.onProgress((p) => { ui.progress.set(p.model, p); schedule(250); });
    }
    newEngine();
    publish(null);
    $('composer').addEventListener('submit', start);
    $('ideaInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) $('composer').requestSubmit(); });
    $('resetBtn').addEventListener('click', reset);
    $('resultsBtn').addEventListener('click', () => { $('modalBody').className = 'results-body'; $('modalBody').replaceChildren(h('pre', {}, markdown(ui.state))); openModal('Results', false); });
    $('saveBtn').addEventListener('click', () => download(`${ui.state.project.project_id}.md`, markdown(ui.state), 'text/markdown'));
    $('diagBtn').addEventListener('click', () => { if (!ui.state) return; renderDiagnostics(); openModal('Диагностика', true); });
    $('reportBtn').addEventListener('click', report);
    $('closeModalBtn').addEventListener('click', () => { $('resultsModal').hidden = true; });
    $('resultsModal').addEventListener('click', (e) => { if (e.target === $('resultsModal')) $('resultsModal').hidden = true; });
    root.addEventListener('pagehide', () => { if (running()) void ui.engine.stop(); });
    render();
  }

  root.AutomationPage = Object.freeze({ markdown });
  boot().catch((error) => { $('centerStatus').textContent = error.message; });
})(window);
