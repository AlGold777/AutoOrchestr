// Automation Lab — diagnostics renderer shared by automation_lab.html and the "Automation" tab of
// the telemetry window on the Pipeline/Results pages. Renders AlDiagnostics output into a container
// using textContent only. Styles: automation/diagnostics-view.css (classes prefixed "ald-").
(function initAlDiagnosticsView(root) {
  'use strict';

  const Diagnostics = root.AlDiagnostics;

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

  const SEVERITY = { critical: ['Критично', 'ald-crit'], action: ['Нужно действие', 'ald-action'], warning: ['Предупреждение', 'ald-warn'], info: ['Инфо', 'ald-info'] };
  const time = (at) => (at ? new Date(at).toLocaleTimeString() : '—');
  const secs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`);
  const pct = (value) => (value == null || Number.isNaN(value) ? '—' : `${Math.round(value * 100)}%`);
  const table = (head, rows) => h('div', { class: 'ald-table-wrap' }, h('table', { class: 'ald-table' },
    h('thead', {}, h('tr', {}, head.map((title) => h('th', {}, title)))), h('tbody', {}, rows)));
  const section = (title, ...content) => h('section', { class: 'ald-section' }, h('h3', {}, title), content);

  function transportBatches(diag) {
    const out = [];
    let current = null;
    diag.forEach((event) => {
      if (event.source === 'transport' && event.kind === 'DISPATCH_SENT') { current = { start: event, events: [] }; out.push(current); }
      else if (current && event.source === 'transport' && event.exec_id === current.start.exec_id) current.events.push(event);
    });
    return out;
  }

  function batchCell(batch, model) {
    const own = batch.events.filter((event) => event.model === model);
    const tabs = batch.events.filter((event) => event.kind === 'TABS' && event.models?.[model]);
    const tab = tabs.some((event) => event.models[model].tab);
    const first = own.find((event) => event.kind === 'MODEL_FIRST_TEXT');
    const terminal = own.find((event) => event.kind === 'MODEL_TERMINAL');
    const timeout = own.find((event) => event.kind === 'MODEL_TIMEOUT');
    const statuses = own.filter((event) => event.kind === 'MODEL_STATUS').map((event) => event.status);
    const parts = [];
    parts.push(tab ? 'вкладка ✓' : (statuses.length || first ? 'вкладка ?' : 'вкладка ✗'));
    if (statuses.length) parts.push(`статусы: ${[...new Set(statuses)].slice(-4).join('→')}`);
    parts.push(first ? `текст через ${secs(first.afterMs)}` : 'текста нет');
    if (terminal) parts.push(`итог ${terminal.status}${terminal.frameComplete ? ' · рамка ✓' : ' · рамка ✗'} · ${terminal.chars} симв.`);
    if (timeout) parts.push(`таймаут${timeout.frameComplete ? ' (рамка полная)' : ''}`);
    const bad = !first || (terminal && !terminal.ok) || (timeout && !timeout.frameComplete);
    return h('td', { class: bad ? 'ald-bad' : '' }, parts.join(' · '));
  }

  function render(container, state, { spec = null } = {}) {
    if (!container) return;
    if (!state) { container.replaceChildren(h('p', { class: 'ald-empty' }, 'Нет проекта Automation Lab.')); return; }
    const diagnosis = Diagnostics.diagnose(state, { spec });
    const { project } = state;
    const critical = diagnosis.problems.filter((problem) => problem.severity === 'critical').length;
    const blocks = [];

    blocks.push(h('div', { class: 'ald-summary' },
      h('strong', {}, project.title), h('span', {}, ` · ${project.project_id} · ${project.workflow_state}${project.next_stage ? ` · следующая стадия ${project.next_stage}` : ''}`),
      h('span', {}, ` · режим: ${project.config?.transport === 'simulator' ? 'симулятор' : 'веб-модели'} · модели: ${(project.config?.models || []).join(', ')} (основная ${project.config?.primary})`),
      critical ? h('span', { class: 'ald-pill ald-crit' }, `критичных проблем: ${critical}`) : h('span', { class: 'ald-pill ald-ok' }, 'критичных проблем нет')));

    blocks.push(section('Проблемы и что делать', diagnosis.problems.length
      ? h('ul', { class: 'ald-problems' }, diagnosis.problems.map((problem) => h('li', { class: `ald-problem ${SEVERITY[problem.severity]?.[1] || ''}` },
        h('div', { class: 'ald-problem-head' },
          h('span', { class: `ald-pill ${SEVERITY[problem.severity]?.[1] || ''}` }, SEVERITY[problem.severity]?.[0] || problem.severity),
          h('strong', {}, problem.title),
          h('span', { class: 'ald-meta' }, [problem.stage ? `стадия ${problem.stage}` : null, problem.attempt ? `попытка ${problem.attempt}` : null, time(problem.at), problem.code].filter(Boolean).join(' · '))),
        problem.detail ? h('p', {}, problem.detail) : null,
        problem.more?.length ? h('p', { class: 'ald-meta' }, problem.more.join(' | ')) : null,
        problem.hint ? h('p', { class: 'ald-hint' }, `Что делать: ${problem.hint}`) : null)))
      : h('p', { class: 'ald-empty' }, 'Проблем не обнаружено.')));

    blocks.push(section('Стадии: что должно было произойти и что произошло', table(
      ['Стадия', 'Ожидание', 'Модели и итог', 'Запусков', 'Статус'],
      diagnosis.stages.map((stage) => h('tr', {},
        h('td', {}, `${stage.stage}. ${stage.title}`),
        h('td', {}, stage.expectation),
        h('td', {}, stage.models.length ? stage.models.map((m) => `${m.model}: ${m.status} (${m.attempts} поп.${m.last_outcome ? `, ${m.last_outcome}` : ''})`).join('; ') : '—'),
        h('td', { class: 'ald-num' }, stage.runs),
        h('td', {}, stage.status))))));

    const batches = transportBatches(state.diag || []);
    blocks.push(section('Транспорт: каждая отправка по моделям', batches.length ? table(
      ['Время', 'Стадия', 'Тип', 'Модель', 'Что наблюдалось'],
      batches.slice().reverse().flatMap((batch) => {
        const rejected = batch.events.find((event) => event.kind === 'DISPATCH_REJECTED');
        const busy = batch.events.find((event) => event.kind === 'BACKGROUND_BUSY');
        return (batch.start.models || []).map((model, index) => h('tr', {},
          h('td', {}, index === 0 ? time(batch.start.at) : ''),
          h('td', {}, index === 0 ? batch.start.stage : ''),
          h('td', {}, index === 0 ? `${batch.start.freshConversation ? 'новый чат' : 'ремонт в том же чате'}${busy ? ' · ждали фон' : ''}` : ''),
          h('td', {}, `${model} (${batch.start.promptChars?.[model] || '?'} симв.)`),
          rejected ? h('td', { class: 'ald-bad' }, `отклонено фоном: ${rejected.code}`) : batchCell(batch, model)));
      })) : h('p', { class: 'ald-empty' }, 'Отправок ещё не было.')));

    blocks.push(section('Провайдеры', diagnosis.providers.length ? table(
      ['Провайдер', 'Вызовы', 'Попытки', 'С первого раза', 'Ремонт → успех', 'Принято', 'Сбой транспорта', 'Сбой извлечения', 'Сбой схемы', 'Медиана', 'p95', 'Режимы извлечения'],
      diagnosis.providers.map((row) => h('tr', {},
        h('td', {}, row.model), h('td', { class: 'ald-num' }, row.calls), h('td', { class: 'ald-num' }, row.attempts),
        h('td', { class: 'ald-num' }, pct(row.firstPass / row.calls)), h('td', { class: 'ald-num' }, row.repairs ? `${row.repairOk}/${row.repairs}` : '—'),
        h('td', { class: 'ald-num' }, pct(row.accepted / row.calls)), h('td', { class: 'ald-num' }, pct(row.transportFail / row.attempts)),
        h('td', { class: 'ald-num' }, pct(row.extractFail / row.attempts)), h('td', { class: 'ald-num' }, pct(row.schemaFail / row.attempts)),
        h('td', { class: 'ald-num' }, secs(row.median)), h('td', { class: 'ald-num' }, secs(row.p95)),
        h('td', {}, Object.entries(row.modes).map(([mode, count]) => `${mode}×${count}`).join(', ') || '—')))) : h('p', { class: 'ald-empty' }, 'Нет данных.')));

    const journal = (state.diag || []).slice().reverse();
    blocks.push(h('details', { class: 'ald-section' }, h('summary', {}, `Журнал событий (${journal.length})`), table(
      ['Время', 'Источник', 'Событие', 'Стадия', 'Модель', 'Данные'],
      journal.slice(0, 400).map((event) => {
        const { project_id: _p, diag_id: _d, at, source, kind, stage, model, ...rest } = event;
        return h('tr', {}, h('td', {}, time(at)), h('td', {}, source), h('td', {}, kind), h('td', {}, stage ?? ''), h('td', {}, model || ''),
          h('td', { class: 'ald-json' }, JSON.stringify(rest).slice(0, 400)));
      }))));

    container.replaceChildren(...blocks);
  }

  const api = Object.freeze({ render, h });
  root.AlDiagnosticsView = api;
})(typeof window !== 'undefined' ? window : globalThis);
