// DOM projection for the Disput diagnostics tab. Runtime control is forbidden here.
// The tab is a live overview; analysis runs on the complete export (scripts/summarize-report.js),
// so the view keeps one display toggle ("Only problems") and no drill-down filters.
(function initDebateTelemetryView(root) {
  'use strict';

  const problemContextFilter = root.ProblemContextFilter
    || (typeof module !== 'undefined' && module.exports ? require('../shared/problem-context-filter') : null);
  const clear = (node) => { while (node?.firstChild) node.removeChild(node.firstChild); };
  const text = (tag, value, className = '') => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    el.textContent = String(value == null ? '' : value);
    return el;
  };
  const duration = (ms) => Number.isFinite(ms) ? `${(ms / 1000).toFixed(ms >= 10000 ? 0 : 1)}s` : '—';
  const renderTable = (target, headers, rows, emptyText) => {
    if (!target) return;
    clear(target);
    if (!rows.length) { target.appendChild(text('p', emptyText, 'diag-empty')); return; }
    const table = document.createElement('table');
    table.className = 'telemetry-rounds-table disput-trace-table';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach((header) => headerRow.appendChild(text('th', header)));
    thead.appendChild(headerRow);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      if (row.className) tr.className = row.className;
      row.cells.forEach((cell) => tr.appendChild(text('td', cell)));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    target.appendChild(table);
  };

  function render(report, doc = document) {
    if (!report || !doc) return false;
    const onlyProblems = doc.getElementById('disput-only-problems')?.checked === true;
    const health = doc.getElementById('disput-health-summary');
    if (health) {
      clear(health);
      const grid = doc.createElement('div');
      grid.className = 'disput-health-grid';
      [
        ['Health', report.health.classification], ['Outcome', report.health.terminalOutcome],
        ['Topology', report.metadata.topology || '—'], ['Preset', report.metadata.presetId || '—'],
        ['Duration', duration(report.runOutcome.durationMs)], ['Stages', `${report.stageExecutions.filter((stage) => ['success', 'skipped'].includes(stage.status)).length}/${report.stageExecutions.length}`],
        ['Problems', report.diagnoses.length], ['Manual recovery', report.health.manualRecoveryCount],
        ['Forced completion', report.health.forcedCompletionCount], ['Data', report.metadata.dataCompleteness]
      ].forEach(([label, value]) => {
        const item = doc.createElement('div'); item.className = 'disput-health-item';
        item.appendChild(text('span', label, 'disput-health-label'));
        item.appendChild(text('strong', value, `disput-health-value disput-health-${report.health.severity}`));
        grid.appendChild(item);
      });
      health.appendChild(grid);
    }
    renderTable(doc.getElementById('disput-problems'), ['Severity', 'Code', 'Stage', 'Model', 'Evidence'], report.diagnoses.map((item) => ({
      className: `disput-severity-${item.severity}`,
      cells: [item.severity, item.code, item.affectedStageId || '—', item.affectedParticipant || '—', item.summary || item.reasonCode || '—']
    })), 'No diagnosed problems.');
    const eventBase = report.events;
    const visibleEvents = onlyProblems && problemContextFilter
      ? problemContextFilter.filterWithContext(eventBase, {
        getContextKey: (event) => event?.correlation?.stageId || event?.stageId || '__unscoped__'
      })
      : (onlyProblems ? eventBase.filter((event) => ['warning', 'high', 'critical'].includes(event.severity)) : eventBase);
    renderTable(doc.getElementById('disput-raw-events'), ['Seq', 'Time', 'Type', 'Source', 'Stage', 'Reason'], visibleEvents.map((event) => ({
      className: `disput-severity-${event.severity}`,
      cells: [event.receivedSeq, new Date(event.sourceTimestamp).toLocaleTimeString(), event.eventType, event.source, event.correlation?.stageId || '—', event.reasonCode || '—']
    })), 'No Debate trace events.');
    const status = doc.getElementById('disput-trace-status');
    if (status) status.textContent = `${report.integrity.eventsTotal} events · ${report.metadata.dataCompleteness}`;
    return true;
  }

  const api = Object.freeze({ render });
  root.DebateTelemetryView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
