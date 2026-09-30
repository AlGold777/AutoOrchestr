// "Automation" tab of the telemetry window (Pipeline and Results pages). Shows the diagnosis of the
// run currently open in the Automation page, mirrored to chrome.storage.session by that page.
(function initAutomationDevtools(root) {
  'use strict';

  const LIVE_KEY = 'automationLab.live';
  const PANEL_ID = 'automation-tabpanel';
  const $ = (id) => document.getElementById(id);
  let spec = null;
  let state = null;

  async function refresh() {
    const panel = $(PANEL_ID);
    const box = $('automation-diagnostics');
    if (!panel || panel.hidden || !box) return;
    if (!spec && root.AlSpec) { try { spec = await root.AlSpec.loadFromFetch('automation-spec/'); } catch (_) { spec = null; } }
    const data = await root.chrome?.storage?.session?.get?.(LIVE_KEY).catch(() => null);
    state = data?.[LIVE_KEY] || null;
    $('automation-export-report').disabled = !state;
    if (!state) { box.replaceChildren(Object.assign(document.createElement('p'), { className: 'ald-empty', textContent: 'Automation не запущен.' })); return; }
    root.AlDiagnosticsView.render(box, state, { spec });
  }

  function report() {
    if (!state) return;
    const text = JSON.stringify(root.AlDiagnostics.buildReport(state, { spec, extensionVersion: root.chrome?.runtime?.getManifest?.().version }), null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `automation-report-${state.project.project_id}.json` });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function init() {
    if (!$(PANEL_ID) || !root.AlDiagnosticsView) return;
    document.addEventListener('devtools-tab-change', (e) => { if (e.detail?.targetId === PANEL_ID) void refresh(); });
    root.chrome?.storage?.onChanged?.addListener((changes, area) => { if (area === 'session' && changes[LIVE_KEY]) void refresh(); });
    $('automation-export-report')?.addEventListener('click', report);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
