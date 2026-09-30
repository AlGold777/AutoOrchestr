// shared/message-delivery-view.js
// Telemetry window → Automation tab: delivery health, problems with next steps, every message's
// timeline, per-model matrix, raw journal and a JSON report. Style follows the Disput tab.
(function initMessageDeliveryView(root) {
  'use strict';

  const KEY = () => root.MessageDelivery?.JOURNAL_KEY || 'messageDelivery.journal';
  const $ = (id) => document.getElementById(id);
  const RESULT = { delivered: 'доставлено ✓', no_token: 'без метки', empty: 'пустой ответ', no_answer: 'нет ответа', no_tab: 'нет вкладки', error: 'ошибка', waiting: 'ждём…' };
  const SEV = { critical: 'Критично', warning: 'Внимание', info: 'Инфо' };
  const time = (at) => (at ? new Date(at).toLocaleTimeString() : '—');
  const secs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`);

  function el(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => { if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v); });
    kids.flat().forEach((kid) => { if (kid != null && kid !== false) node.append(kid instanceof Node ? kid : document.createTextNode(String(kid))); });
    return node;
  }
  const table = (head, rows) => el('table', { class: 'telemetry-rounds-table' }, el('thead', null, el('tr', null, head.map((t) => el('th', null, t)))), el('tbody', null, rows));
  const empty = (text) => el('p', { class: 'diag-empty' }, text);

  async function readJournal() {
    try {
      const data = await root.chrome.storage.session.get(KEY());
      return Array.isArray(data?.[KEY()]) ? data[KEY()] : [];
    } catch (_) {
      return root.MessageDelivery?.journal() || [];
    }
  }

  function filtered(journal) {
    const model = $('automation-model-filter')?.value || 'all';
    const only = $('automation-only-problems')?.checked;
    const diagnosis = root.MessageDeliveryDiagnosis.diagnose(journal);
    const keep = (item) => model === 'all' || item.model === model;
    return {
      journal, diagnosis,
      sends: diagnosis.sends.filter((s) => keep(s) && (!only || s.result !== 'delivered' || s.stale)),
      problems: diagnosis.problems.filter(keep),
      matrix: diagnosis.matrix.filter(keep),
      raw: journal.filter(keep)
    };
  }

  function sendRow(send) {
    const flow = [
      send.tab != null ? `вкладка ${send.tab}` : 'вкладки нет',
      send.statuses.length ? send.statuses.join(' → ') : null,
      send.firstTextMs != null ? `текст через ${secs(send.firstTextMs)}` : 'текста нет'
    ].filter(Boolean).join(' · ');
    const t = send.terminal;
    const end = t ? `${secs(t.ms)}${t.chars != null ? ` · ${t.chars} симв.` : ''}${t.status ? ` · ${t.status}` : ''}${t.reason ? ` · ${t.reason}` : ''}` : '—';
    const row = el('tr', null, el('td', null, time(send.at)), el('td', null, send.model), el('td', null, send.batchId || '—'), el('td', null, flow), el('td', null, end), el('td', null, RESULT[send.result]));
    if (!['delivered', 'waiting'].includes(send.result)) row.style.color = 'var(--danger, #b42318)';
    return row;
  }

  async function render() {
    const panel = $('automation-tabpanel');
    if (!panel || panel.hidden) return;
    const journal = await readJournal();
    const view = filtered(journal);
    const models = [...new Set(view.diagnosis.sends.map((s) => s.model))];
    const select = $('automation-model-filter');
    const current = select.value;
    select.replaceChildren(new Option('All models', 'all'), ...models.map((m) => new Option(m, m)));
    select.value = models.includes(current) ? current : 'all';

    const all = view.diagnosis.sends;
    const crit = view.diagnosis.problems.filter((p) => p.severity === 'critical').length;
    $('automation-status').textContent = all.length ? `${all.length} sent · ${all.filter((s) => s.result === 'delivered').length} delivered · ${crit} critical` : '';

    $('automation-health').replaceChildren(all.length ? table(
      ['Model', 'Sent', 'Delivered', 'No token', 'Empty', 'No answer', 'No tab', 'Stale dropped', 'Median time'],
      view.matrix.map((r) => el('tr', null, el('td', null, r.model), el('td', null, r.sent), el('td', null, r.delivered), el('td', null, r.no_token), el('td', null, r.empty), el('td', null, r.no_answer), el('td', null, r.no_tab), el('td', null, r.stale), el('td', null, secs(r.medianMs))))) : empty('No messages yet.'));

    $('automation-problems').replaceChildren(view.problems.length
      ? el('div', null, view.problems.map((p) => el('div', { class: 'ad-problem', 'data-severity': p.severity },
        el('div', { class: 'ad-problem-head' }, el('strong', null, `[${SEV[p.severity]}] ${p.title}`), el('span', { class: 'devtools-meta' }, ` ${time(p.at)}${p.batchId ? ` · ${p.batchId}` : ''}${p.reason ? ` · ${p.reason}` : ''}`)),
        el('div', null, p.detail),
        p.hint ? el('div', { class: 'ad-hint' }, `Что делать: ${p.hint}`) : null)))
      : empty(all.length ? 'No problems.' : 'No diagnoses yet.'));

    $('automation-messages').replaceChildren(view.sends.length
      ? table(['Sent', 'Model', 'Batch', 'Path', 'Finish', 'Result'], view.sends.slice().reverse().map(sendRow))
      : empty(all.length ? 'Nothing matches the filter.' : 'No messages yet.'));

    $('automation-raw').replaceChildren(view.raw.length
      ? table(['Time', 'Model', 'Event', 'Details'], view.raw.slice().reverse().map((e) => {
        const { at, model, kind, token, ...rest } = e;
        return el('tr', null, el('td', null, time(at)), el('td', null, model || ''), el('td', null, kind), el('td', null, `${token || ''} ${JSON.stringify(rest)}`));
      }))
      : empty('No journal events.'));
  }

  async function report() {
    const journal = await readJournal();
    const text = JSON.stringify({
      report: 'message-delivery',
      generated_at: new Date().toISOString(),
      extension_version: root.chrome?.runtime?.getManifest?.().version,
      diagnosis: root.MessageDeliveryDiagnosis.diagnose(journal),
      journal
    }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'message-delivery-report.json' });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function init() {
    if (!$('automation-tabpanel')) return;
    document.addEventListener('devtools-tab-change', (e) => { if (e.detail?.targetId === 'automation-tabpanel') void render(); });
    root.chrome?.storage?.onChanged?.addListener((changes, area) => { if (area === 'session' && changes[KEY()]) void render(); });
    ['automation-model-filter', 'automation-only-problems'].forEach((id) => $(id)?.addEventListener('change', () => void render()));
    $('automation-clear')?.addEventListener('click', () => { root.MessageDelivery?.clearJournal(); void render(); });
    $('automation-export-json')?.addEventListener('click', report);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
