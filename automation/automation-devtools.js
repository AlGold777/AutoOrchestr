// "Automation" tab of the telemetry window (Pipeline and Results pages). Reads the Automation Lab
// IndexedDB read-only and renders the same diagnosis the lab shows, refreshing while visible.
(function initAutomationDevtools(root) {
  'use strict';

  const PANEL_ID = 'automation-tabpanel';
  const REFRESH_MS = 3000;
  const view = { spec: null, store: null, projectId: null, timer: null, loading: false };
  const $ = (id) => document.getElementById(id);

  async function ensureLoaded() {
    if (!view.spec && root.AlSpec) {
      try { view.spec = await root.AlSpec.loadFromFetch('automation-spec/'); } catch (_) { view.spec = null; }
    }
  }

  async function refresh() {
    const panel = $(PANEL_ID);
    const container = $('automation-diagnostics');
    if (!panel || panel.hidden || !container || view.loading) return;
    view.loading = true;
    try {
      await ensureLoaded();
      const { store, projects } = await root.AlDiagnosticsView.readProjects();
      view.store = store;
      const select = $('automation-project-select');
      if (!projects.length) {
        select.replaceChildren(new Option('Нет проектов', ''));
        container.replaceChildren(Object.assign(document.createElement('p'), { className: 'ald-empty', textContent: 'Automation Lab ещё не запускался. Откройте его иконкой колбы в верхней панели Pipeline.' }));
        return;
      }
      if (!projects.some((project) => project.project_id === view.projectId)) view.projectId = projects[0].project_id;
      select.replaceChildren(...projects.map((project) => new Option(`${project.title.slice(0, 50)} · ${project.workflow_state}`, project.project_id, false, project.project_id === view.projectId)));
      const state = await root.AlDiagnosticsView.readState(store, view.projectId);
      root.AlDiagnosticsView.render(container, state, { spec: view.spec });
      $('automation-diag-status').textContent = `обновлено ${new Date().toLocaleTimeString()}`;
      store.close();
    } catch (error) {
      container.textContent = `Не удалось прочитать данные Automation Lab: ${error.message}`;
    } finally {
      view.loading = false;
    }
  }

  function schedule() {
    clearInterval(view.timer);
    view.timer = setInterval(() => {
      const panel = $(PANEL_ID);
      if (!panel || panel.hidden || panel.closest('[hidden]') || document.hidden) return;
      void refresh();
    }, REFRESH_MS);
  }

  async function exportReport() {
    if (!view.projectId) return;
    await ensureLoaded();
    const { store } = await root.AlDiagnosticsView.readProjects();
    const state = await root.AlDiagnosticsView.readState(store, view.projectId);
    store.close();
    const report = root.AlDiagnostics.buildReport(state, { spec: view.spec, extensionVersion: root.chrome?.runtime?.getManifest?.().version || null });
    const text = JSON.stringify(report, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: `automation-report-${view.projectId}.json` });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    try { await navigator.clipboard.writeText(text); $('automation-diag-status').textContent = 'отчёт скопирован и сохранён'; } catch (_) { $('automation-diag-status').textContent = 'отчёт сохранён файлом'; }
  }

  function init() {
    if (!$(PANEL_ID) || !root.AlDiagnosticsView) return;
    document.addEventListener('devtools-tab-change', (event) => { if (event.detail?.targetId === PANEL_ID) void refresh(); });
    $('automation-project-select')?.addEventListener('change', (event) => { view.projectId = event.target.value; void refresh(); });
    $('automation-refresh')?.addEventListener('click', () => void refresh());
    $('automation-export-report')?.addEventListener('click', () => void exportReport());
    $('automation-open-lab')?.addEventListener('click', () => { try { root.open('automation_lab.html', '_blank', 'noopener'); } catch (_) { /* ignore */ } });
    schedule();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
