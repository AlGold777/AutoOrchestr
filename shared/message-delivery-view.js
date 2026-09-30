// shared/message-delivery-view.js
// Telemetry window → Automation tab: message delivery journal (sent / verified / missing token /
// stale dropped) with a JSON report for analysis.
(function initMessageDeliveryView(root) {
  'use strict';

  const LABELS = { sent: 'sent', verified: 'delivered ✓', missing_token: 'no token', stale_dropped: 'stale answer dropped' };
  const $ = (id) => document.getElementById(id);
  const readJournal = async () => {
    try {
      const key = root.MessageDelivery?.JOURNAL_KEY || 'messageDelivery.journal';
      const data = await root.chrome.storage.session.get(key);
      return Array.isArray(data?.[key]) ? data[key] : [];
    } catch (_) {
      return root.MessageDelivery?.journal() || [];
    }
  };
  const cell = (tag, text) => { const node = document.createElement(tag); node.textContent = text; return node; };

  async function render() {
    const box = $('delivery-journal');
    if (!box || $('automation-tabpanel')?.hidden) return;
    const journal = await readJournal();
    if (!journal.length) { box.replaceChildren(Object.assign(document.createElement('p'), { className: 'diag-empty', textContent: 'No messages yet.' })); return; }
    const count = (kind) => journal.filter((e) => e.kind === kind).length;
    const summary = cell('p', `Sent ${count('sent')} · delivered ${count('verified')} · no token ${count('missing_token')} · stale dropped ${count('stale_dropped')}`);
    const table = document.createElement('table');
    table.className = 'telemetry-rounds-table';
    const head = document.createElement('tr');
    ['Time', 'Model', 'Event', 'Token', 'Chars', 'ms'].forEach((title) => head.append(cell('th', title)));
    table.append(head);
    journal.slice().reverse().forEach((e) => {
      const row = document.createElement('tr');
      [new Date(e.at).toLocaleTimeString(), e.model || '', LABELS[e.kind] || e.kind, e.token || '', e.chars ?? '', e.ms ?? ''].forEach((value) => row.append(cell('td', String(value))));
      if (e.kind === 'missing_token' || e.kind === 'stale_dropped') row.style.color = 'var(--danger, #b42318)';
      table.append(row);
    });
    box.replaceChildren(summary, table);
  }

  async function report() {
    const text = JSON.stringify({ report: 'message-delivery', generated_at: new Date().toISOString(), extension_version: root.chrome?.runtime?.getManifest?.().version, journal: await readJournal() }, null, 2);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = Object.assign(document.createElement('a'), { href: url, download: 'message-delivery-report.json' });
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    navigator.clipboard?.writeText(text).catch(() => {});
  }

  function init() {
    if (!$('automation-tabpanel')) return;
    document.addEventListener('devtools-tab-change', (e) => { if (e.detail?.targetId === 'automation-tabpanel') void render(); });
    root.chrome?.storage?.onChanged?.addListener((changes, area) => { if (area === 'session' && changes[root.MessageDelivery?.JOURNAL_KEY || 'messageDelivery.journal']) void render(); });
    $('delivery-report-btn')?.addEventListener('click', report);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})(window);
