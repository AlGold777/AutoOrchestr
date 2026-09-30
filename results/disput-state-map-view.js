(function initDisputStateMapView(root) {
  'use strict';
  const escape = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const label = (item) => escape(item.title || item.id || 'Без названия');
  const status = (item) => `<span class="disput-map-badge disput-map-status-${escape(item.status)}">${escape(item.status || item.type || '')}</span>`;
  const removableLink = (item) => Boolean(item?.targetId && item?.provenance?.source === 'state_map_drawer');

  function relationSummary(item, map) {
    if (item.type !== 'claim') return item.targetId ? `<button type="button" class="disput-map-link" data-map-focus="${escape(item.targetId)}">Связано с ${escape(item.targetId)}</button>` : '';
    const objections = map.objections.filter((entry) => entry.targetId === item.id);
    const blockers = objections.filter((entry) => map.blockers.some((blocker) => blocker.id === entry.id));
    const objectionIds = new Set(objections.map((entry) => entry.id));
    const evidence = map.evidence.filter((entry) => entry.targetId === item.id || objectionIds.has(entry.targetId));
    return `<span>${objections.length} objections${blockers.length ? ` · ${blockers.length} blocking` : ''} · ${evidence.length} evidence</span>`;
  }

  function card(item, map) {
    const blocking = map.blockers.some((entry) => entry.id === item.id);
    const expandable = String(item.description || '').length > 180;
    const removeButton = removableLink(item) ? `<button type="button" class="disput-map-link-remove" data-map-link-remove="${escape(item.id)}" aria-label="Удалить связь ${escape(item.id)}" title="Удалить связь">×</button>` : '';
    return `<article class="disput-map-card disput-map-type-${escape(item.type)}${blocking ? ' is-blocking' : ''}" data-map-item="${escape(item.id)}" tabindex="0" role="button" aria-label="Открыть подробности ${label(item)}">
      <div class="disput-map-card-head"><strong>[${escape(item.id)}] ${label(item)}</strong><span class="disput-map-card-status">${removeButton}${status(item)}</span></div>
      ${item.description ? `<p class="${expandable ? 'is-collapsed' : ''}">${escape(item.description)}</p>${expandable ? '<button type="button" class="disput-map-expand" data-map-expand>Показать полностью</button>' : ''}` : ''}
      <div class="disput-map-card-meta">${relationSummary(item, map)}${item.requiredAction ? `<span>Требуется: ${escape(item.requiredAction)}</span>` : ''}${item.owner ? `<span>Ответственный: ${escape(item.owner)}</span>` : ''}${item.confidence ? `<span>Extraction: ${Math.round(item.confidence * 100)}%</span>` : ''}${item.revision ? `<span>Revision ${item.revision}</span>` : ''}</div>
    </article>`;
  }

  function comparisonHtml(diff) {
    if (!diff) return '';
    const group = (title, ids, kind) => `<div><strong>${title} (${ids.length})</strong>${ids.map((id) => `<button type="button" data-map-focus="${escape(id)}" data-diff-kind="${kind}">${escape(id)}</button>`).join('') || '<span>нет</span>'}</div>`;
    return `<section class="disput-map-comparison"><header><strong>Сравнение ${escape(diff.from)} → ${escape(diff.to)}</strong><button type="button" data-map-compare-close>Закрыть</button></header>${group('Добавлено', diff.added, 'added')}${group('Изменено', diff.changed, 'changed')}${group('Удалено', diff.removed, 'removed')}</section>`;
  }

  function sortItems(items, map) {
    const rank = (item) => map.blockers.some((entry) => entry.id === item.id || entry.targetId === item.id) ? 0
      : ['open', 'raised', 'unresolved', 'contested'].includes(item.status) ? 1
        : item.status === 'dissent' ? 2 : item.status === 'accepted_as_limitation' ? 3 : 4;
    return items.slice().sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
  }

  function attention(map) {
    if (!map.attention.length) return '<p class="disput-map-empty">Критических элементов нет.</p>';
    return map.attention.map((item) => item.type === 'axis_verdict' ? `<button type="button" class="disput-map-axis-alert" data-map-axis="${escape(item.id)}"><strong>${escape(item.title || item.id)}</strong><span>${escape(item.status)}</span></button>` : card(item, map)).join('');
  }

  function structure(map, filter, query) {
    const q = query.trim().toLowerCase();
    const visible = (item) => {
      if (q && !`${item.id} ${item.title} ${item.description} ${item.owner}`.toLowerCase().includes(q)) return false;
      if (filter === 'open' && !['open', 'raised', 'unresolved', 'clarifying', 'partially_closed', 'reopened', 'asserted', 'contested', 'disputed'].includes(item.status)) return false;
      if (filter === 'blocking' && !map.blockers.some((entry) => entry.id === item.id || entry.targetId === item.id)) return false;
      if (filter === 'dissent' && item.status !== 'dissent' && item.type !== 'dissent') return false;
      return true;
    };
    const claims = sortItems([...map.claims, ...(map.assumptions || []), ...(map.decisionCriteria || [])].filter(visible), map);
    const problems = sortItems([...map.objections, ...map.dissent, ...(map.contradictions || []), ...(map.openQuestions || []), ...map.limitations, ...map.evidenceGaps].filter(visible), map);
    const evidence = sortItems(map.evidence.filter(visible), map);
    const revisions = sortItems(map.revisions.filter(visible), map);
    const visibleCount = claims.length + problems.length + evidence.length + revisions.length;
    const totalCount = map.claims.length + (map.assumptions || []).length + (map.decisionCriteria || []).length + map.objections.length + map.dissent.length + (map.contradictions || []).length + (map.openQuestions || []).length + map.limitations.length + map.evidenceGaps.length + map.evidence.length + map.revisions.length;
    const hidden = Math.max(0, totalCount - visibleCount);
    const empty = '<p class="disput-map-empty">Нет элементов, соответствующих фильтру. <button type="button" data-map-reset>Сбросить</button></p>';
    const decisions = (map.pendingDecisions || []).map((request) => `<article class="disput-map-decision" data-decision-request="${escape(request.requestId)}" aria-labelledby="decision-title-${escape(request.requestId)}"><strong id="decision-title-${escape(request.requestId)}">${escape(request.question)}</strong><span>${escape(request.reason)}</span><small>Request ${escape(request.requestId)}${request.affectedStageId || request.stageId ? ` · Stage ${escape(request.affectedStageId || request.stageId)}` : ''}</small><div>${(request.options || []).map((option) => `<button type="button" data-map-decision-option="${escape(option.id)}" data-request-id="${escape(request.requestId)}"${option.id === request.recommendedOptionId ? ' class="is-recommended"' : ''}>${escape(option.label || option.id)}</button>`).join('')}</div></article>`).join('');
    const conflicts = (map.contradictions || []).length
      ? `<section class="disput-map-conflicts" aria-label="Конфликты карты"><h3>Конфликты</h3>${map.contradictions.map((item) => `<article data-conflict-id="${escape(item.id)}"><strong>${label(item)}</strong><span>${escape(item.description || item.status)}</span><small>Source ${escape(item.provenance?.turnId || item.provenance?.source || 'unknown')}</small><button type="button" data-map-human-action="approve_closure" data-item-id="${escape(item.id)}">Разрешить</button><button type="button" data-map-human-action="request_evidence" data-item-id="${escape(item.id)}">Запросить evidence</button></article>`).join('')}</section>`
      : '';
    const automation = map.automation ? `<section class="disput-map-automation"><header><h3>Universal orchestration</h3><span>${map.automation.active.length} active · ${map.automation.queue.length} queued · budget ${map.automation.budget.used || 0}/${map.automation.budget.limit == null ? '∞' : map.automation.budget.limit}</span><div><button type="button" data-map-human-action="pause" data-item-id="">${map.technicalStatus === 'paused' ? 'Resume' : 'Pause'}</button><button type="button" data-map-human-action="synthesize" data-item-id="">Synthesize now</button><button type="button" data-map-human-action="stop" data-item-id="">Stop</button></div></header>
      ${decisions}${[...map.automation.active, ...map.automation.queue].filter((task) => task.status !== 'awaiting_confirmation').slice(0, 8).map((task) => `<article><strong>${escape(task.role)} · ${escape(task.actionContract?.instruction || task.action)}</strong><span>${escape(task.explanation || task.reason)}</span><small>${escape(task.status)}${task.independence ? ` · ${escape(task.independence)}` : ''}</small></article>`).join('') || (decisions ? '' : '<p class="disput-map-empty">Очередь пуста.</p>')}</section>` : (decisions ? `<section class="disput-map-automation">${decisions}</section>` : '');
    const diff = map.diff && (map.diff.added.length || map.diff.changed.length || map.diff.removed.length) ? `<section class="disput-map-diff"><strong>Изменения последнего снимка</strong><span>+${map.diff.added.length} · ~${map.diff.changed.length} · −${map.diff.removed.length}</span><small>${escape([...map.diff.added, ...map.diff.changed, ...map.diff.removed].slice(0, 12).join(', '))}</small></section>` : '';
    const task = map.taskContract ? `<section class="disput-map-task-contract"><strong>${escape(map.taskContract.objective)}</strong><span>${escape(map.taskContract.taskClass)} · evidence ${escape(map.taskContract.evidencePolicy)}${map.taskContract.maxWords ? ` · ≤ ${escape(map.taskContract.maxWords)} слов` : ''}</span>${map.taskContract.currentInstruction ? `<small>Сейчас: ${escape(map.taskContract.currentInstruction)}</small>` : ''}</section>` : '';
    return `<div class="disput-map-results-count" aria-live="polite">Показано ${visibleCount} из ${totalCount}${hidden ? ` · скрыто ${hidden}` : ''}</div>${task}${diff}${automation}${conflicts}<section class="disput-map-attention"><h3>Требует внимания</h3>${attention(map)}</section>
      <div class="disput-map-structure">
        <section class="disput-map-panel"><header><h3>Текущие позиции</h3><span>${claims.length}</span></header><div>${claims.map((item) => card(item, map)).join('') || empty}</div></section>
        <aside class="disput-map-side">
          <section class="disput-map-panel"><header><h3>Оси проверки</h3><span>${map.axes.length}</span></header><div>${map.axes.map((axis) => `<button type="button" class="disput-map-axis" data-map-axis="${escape(axis.id)}"><span>${escape(axis.title || axis.id)}</span><strong>${escape(axis.status)}</strong></button>`).join('') || '<p class="disput-map-empty">Оси ещё не сформированы.</p>'}</div></section>
          <section class="disput-map-panel"><header><h3>Изменения позиций</h3><span>${revisions.length}</span></header><div>${revisions.map((item) => card(item, map)).join('') || empty}</div></section>
          <section class="disput-map-panel"><header><h3>Проблемы и ограничения</h3><span>${problems.length}</span></header><div>${problems.map((item) => card(item, map)).join('') || empty}</div></section>
          <section class="disput-map-panel"><header><h3>Evidence</h3><span>${evidence.length}</span></header><div>${evidence.map((item) => card(item, map)).join('') || empty}</div></section>
        </aside>
      </div>`;
  }

  function history(map) {
    const evaluations = map.ruleEvaluations || [];
    const progress = map.progressWindow || [];
    const signals = map.modelSignals || [];
    const summary = Object.values(map.ruleHistory?.byRule || {}).sort((a, b) => b.fired - a.fired);
    const pct = (value) => value == null ? '—' : `${Math.round(Number(value) * 100)}%`;
    return `<div class="disput-map-history">
      <section class="disput-map-panel"><header><h3>Правила в текущем запуске</h3><span>${evaluations.length}</span></header><div>${evaluations.slice(-100).reverse().map((item) => `<article><strong>${escape(item.triggerId || item.ruleId)}</strong><span>${escape(item.status || item.eventType)}${item.targetId ? ` · ${escape(item.targetId)}` : ''}</span><small>${escape(item.reasonCode || item.ruleMode || '')}</small></article>`).join('') || '<p class="disput-map-empty">Правила ещё не оценивались.</p>'}</div></section>
      <section class="disput-map-panel"><header><h3>Окно прогресса</h3><span>${progress.filter((item) => item.stateChanged).length}/${progress.length}</span></header><div>${progress.slice().reverse().map((item) => `<article><strong>${escape(item.triggerId || item.taskId || 'шаг')}</strong><span>${item.stateChanged ? 'Карта изменилась' : 'Без изменения карты'}</span><small>${escape(item.outcome || '')}</small></article>`).join('') || '<p class="disput-map-empty">Данных о прогрессе пока нет.</p>'}</div></section>
      <section class="disput-map-panel"><header><h3>Полезность правил между запусками</h3><span>${map.ruleHistory?.runCount || 0} runs</span></header><div>${summary.map((item) => `<article><strong>${escape(item.triggerId)}</strong><span>сработало ${item.fired}/${item.evaluated} · fire ${pct(item.fireRate)}</span><small>изменение карты после действия: ${pct(item.progressRate)}</small></article>`).join('') || '<p class="disput-map-empty">История накопится после завершённых запусков.</p>'}</div></section>
      <section class="disput-map-panel"><header><h3>Сигналы моделей (только диагностика)</h3><span>${signals.length}</span></header><div>${signals.slice(-30).reverse().map((item) => `<article><strong>${escape(item.signal?.type || item.eventType)}</strong><span>${escape(item.model || '')} · ${escape(item.signal?.targetId || '')}</span><small>${escape(item.signal?.reason || (item.errors || []).join(', '))}</small></article>`).join('') || '<p class="disput-map-empty">Диагностических сигналов нет.</p>'}</div></section>
    </div>`;
  }

  function graf(map, filter, query) {
    const all = [...map.claims, ...(map.assumptions || []), ...(map.decisionCriteria || []), ...map.revisions, ...map.objections, ...map.dissent, ...(map.contradictions || []), ...(map.openQuestions || []), ...map.limitations, ...map.evidenceGaps, ...map.evidence];
    const q = query.trim().toLowerCase();
    const openStatuses = new Set(['open', 'raised', 'unresolved', 'clarifying', 'partially_closed', 'reopened', 'asserted', 'contested', 'disputed']);
    const visibleIds = new Set(all.filter((item) => (!q || `${item.id} ${item.title}`.toLowerCase().includes(q)) && (filter !== 'open' || openStatuses.has(item.status)) && (filter !== 'blocking' || map.blockers.some((entry) => entry.id === item.id || entry.targetId === item.id)) && (filter !== 'dissent' || item.status === 'dissent' || item.type === 'dissent')).map((item) => item.id));
    const column = (title, items) => `<section class="disput-graf-column"><h3>${title}</h3>${sortItems(items.filter((item) => visibleIds.has(item.id)), map).map((item) => card(item, map)).join('') || '<p class="disput-map-empty">Нет элементов.</p>'}</section>`;
    return `<div class="disput-graf" data-links="${map.links.length}"><svg class="disput-graf-links" aria-hidden="true"><defs><marker id="disput-graf-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z"></path></marker></defs><g></g></svg>${column('Позиции и revisions', [...map.claims, ...(map.assumptions || []), ...(map.decisionCriteria || []), ...map.revisions])}${column('Проблемы и dissent', [...map.objections, ...map.dissent, ...(map.contradictions || []), ...(map.openQuestions || []), ...map.limitations, ...map.evidenceGaps])}${column('Evidence', map.evidence)}</div>`;
  }

  function findItem(map, id) {
    return [...map.claims, ...(map.assumptions || []), ...(map.decisionCriteria || []), ...map.objections, ...map.evidence, ...map.revisions, ...map.dissent, ...(map.contradictions || []), ...(map.openQuestions || []), ...map.limitations, ...map.evidenceGaps, ...map.axes].find((item) => item.id === id) || null;
  }

  function drawerHtml(item, map) {
    if (!item) return '';
    const related = map.links.filter((link) => link.from === item.id || link.to === item.id);
    const sourceId = item.provenance?.turnId || item.provenance?.messageId || item.provenance?.entryId || '';
    return `<header><strong>[${escape(item.id)}] ${label(item)}</strong><button type="button" data-map-drawer-close aria-label="Закрыть подробности">×</button></header>
      <div class="disput-map-drawer-body">${status(item)}
        <section class="disput-map-drawer-human-actions"><h4>Действия человека</h4><div class="disput-map-human-actions"><button type="button" data-map-human-action="approve_closure" data-item-id="${escape(item.id)}">Подтвердить закрытие</button><button type="button" data-map-human-action="reject_closure" data-item-id="${escape(item.id)}">Оставить открытым</button><button type="button" data-map-human-action="request_evidence" data-item-id="${escape(item.id)}">Запросить evidence</button><button type="button" data-map-human-action="assign" data-item-id="${escape(item.id)}">Назначить</button></div></section>
        <section class="disput-map-drawer-links"><h4>Связи</h4>${related.map((link) => `<div class="disput-map-related-link"><button type="button" class="disput-map-link" data-map-focus="${escape(link.from === item.id ? link.to : link.from)}">${escape(link.type)} → ${escape(link.from === item.id ? link.to : link.from)}</button>${link.removable ? `<button type="button" class="disput-map-link-remove" data-map-link-remove="${escape(link.from)}" aria-label="Удалить связь ${escape(link.from)}" title="Удалить связь">×</button>` : ''}</div>`).join('') || '<span>Связей нет.</span>'}</section>
        <section class="disput-map-drawer-source"><button type="button" data-map-source="${escape(sourceId)}"${sourceId ? '' : ' disabled'}>Перейти к исходному ответу</button></section>
        <details class="disput-map-system-information"><summary>System Information</summary><div class="disput-map-system-information-body">
          <p>${escape(item.description || item.title || '')}</p>
          <dl><dt>Тип</dt><dd>${escape(item.type)}</dd><dt>Owner</dt><dd>${escape(item.owner || 'не назначен')}</dd><dt>Required action</dt><dd>${escape(item.requiredAction || 'нет')}</dd><dt>Extraction confidence</dt><dd>${item.confidence ? `${Math.round(item.confidence * 100)}%` : 'не указана'}</dd><dt>Revision</dt><dd>${escape(item.revision || 0)}</dd><dt>Возраст / изменение</dt><dd>${escape(item.lastChangedAt || item.openedAt || '—')}</dd></dl>
          <section><h4>История</h4><pre>${escape(JSON.stringify(item.history || [], null, 2))}</pre></section>
          <section><h4>Provenance</h4><pre>${escape(JSON.stringify(item.provenance || {}, null, 2))}</pre></section>
        </div></details>
      </div>`;
  }

  function init(options = {}) {
    const panel = document.getElementById('disput-state-map-panel');
    if (!panel || !root.DebateStateMap) return null;
    const header = panel.querySelector('[data-map-collapse]');
    const close = panel.querySelector('[data-map-close]');
    const body = panel.querySelector('.disput-state-map-workspace');
    const content = panel.querySelector('[data-map-content]');
    const title = panel.querySelector('[data-map-title]');
    const summaries = panel.querySelectorAll('[data-map-summary]');
    const search = panel.querySelector('[data-map-search]');
    const drawer = panel.querySelector('[data-map-drawer]');
    const runSelect = panel.querySelector('[data-map-run]');
    const caseImport = panel.querySelector('[data-case-import]');
    const compareA = panel.querySelector('[data-map-compare-a]');
    const compareB = panel.querySelector('[data-map-compare-b]');
    let mode = 'structure'; let filter = 'all'; let zoom = 1; let selectedId = ''; let comparison = null; let map = root.DebateStateMap.project({}); let caseMap = map;
    let pendingAggregate;
    const shellOnly = panel.dataset.mapShell === 'true';

    if (shellOnly) {
      const projectAggregate = (aggregate) => {
        if (aggregate) {
          map = root.DebateStateMap.project({ ...aggregate, ruleHistory: aggregate.ruleHistory || options.getRuleHistory?.() || null });
          caseMap = map;
          comparison = null;
        }
        panel.dataset.status = map.readiness.id;
        return map;
      };
      const render = (aggregate) => projectAggregate(aggregate !== undefined ? aggregate : options.getAggregate?.());
      const setOpen = (open) => {
        panel.classList.toggle('is-open', open);
        header?.setAttribute('aria-expanded', String(open));
        if (body) body.hidden = !open;
      };
      const refreshRuns = async () => options.caseStore?.list?.() || [];
      const downloadJson = (payload, filename) => {
        const blob = new Blob([payload], { type: 'application/json' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.click();
        URL.revokeObjectURL(link.href);
      };
      const handleOutsideClick = (event) => {
        if (!panel.classList.contains('is-open') || panel.contains(event.target)) return;
        setOpen(false);
      };

      header?.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
      close?.addEventListener('click', () => setOpen(false));
      document.addEventListener('click', handleOutsideClick);

      panel.addEventListener('click', (event) => {
        if (event.target.closest('[data-map-export]')) {
          downloadJson(JSON.stringify(map, null, 2), `disput-state-map-${map.runId || 'idle'}.json`);
          return;
        }
        if (event.target.closest('[data-case-export]')) {
          const serialized = options.caseStore?.exportCase?.();
          if (serialized) downloadJson(serialized, `disput-case-${map.runId || 'case'}.json`);
          return;
        }
        if (event.target.closest('[data-case-import-action]')) {
          caseImport?.click();
          return;
        }
        if (event.target.closest('[data-case-delete]')) {
          const id = options.caseStore?.getState?.()?.caseId;
          if (id) {
            void options.caseStore?.remove?.(id).then(() => render(options.getAggregate?.()));
          }
        }
      });

      caseImport?.addEventListener('change', async () => {
        try {
          const serialized = await caseImport.files?.[0]?.text?.();
          if (serialized) {
            const imported = await options.caseStore?.importCase?.(serialized);
            projectAggregate(imported);
          }
        } finally {
          caseImport.value = '';
        }
      });

      options.caseStore?.subscribe?.(() => { void refreshRuns(); });
      projectAggregate(options.aggregate || options.getAggregate?.());
      return Object.freeze({ render, getMap: () => map, refreshRuns, open: () => setOpen(true), close: () => setOpen(false) });
    }
    const drawLinks = () => {
      const graph = content.querySelector('.disput-graf'); const svg = graph?.querySelector('.disput-graf-links'); const group = svg?.querySelector('g');
      if (!graph || !svg || !group) return;
      const bounds = graph.getBoundingClientRect(); svg.setAttribute('viewBox', `0 0 ${graph.scrollWidth} ${graph.scrollHeight}`); svg.setAttribute('width', graph.scrollWidth); svg.setAttribute('height', graph.scrollHeight);
      group.innerHTML = map.links.map((link) => {
        const from = graph.querySelector(`[data-map-item="${CSS.escape(link.from)}"]`); const to = graph.querySelector(`[data-map-item="${CSS.escape(link.to)}"]`);
        if (!from || !to) return '';
        const a = from.getBoundingClientRect(); const b = to.getBoundingClientRect();
        const x1 = (a.left - bounds.left + a.width / 2) / zoom; const y1 = (a.top - bounds.top + a.height / 2) / zoom;
        const x2 = (b.left - bounds.left + b.width / 2) / zoom; const y2 = (b.top - bounds.top + b.height / 2) / zoom;
        return `<path class="disput-graf-link disput-graf-link-${escape(link.type)}${link.blocking ? ' is-blocking' : ''}" d="M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}" marker-end="url(#disput-graf-arrow)"></path>`;
      }).join('');
    };
    const renderWorkspace = () => {
      if (pendingAggregate !== undefined) {
        const aggregate = pendingAggregate;
        pendingAggregate = undefined;
        if (aggregate) {
          map = root.DebateStateMap.project({ ...aggregate, ruleHistory: aggregate.ruleHistory || options.getRuleHistory?.() || null });
          caseMap = map;
          comparison = null;
        }
      }
      title.textContent = map.title || 'Карта состояния';
      summaries.forEach((summary) => { summary.textContent = `${map.profileId || 'Без профиля'} · ${map.currentStageId || 'этап не начат'} · ${map.readiness.label} · ${map.stats.blockers} blocking · ${map.technicalStatus}`; });
      panel.dataset.status = map.readiness.id;
      panel.querySelectorAll('[data-map-mode]').forEach((button) => button.classList.toggle('is-active', button.dataset.mapMode === mode));
      panel.querySelectorAll('[data-map-filter]').forEach((button) => button.classList.toggle('is-active', button.dataset.mapFilter === filter));
      content.innerHTML = comparisonHtml(comparison) + (mode === 'graf' ? graf(map, filter, search.value || '') : mode === 'history' ? history(map) : structure(map, filter, search.value || ''));
      const snapshotOptions = caseMap.snapshots || [];
      const previousA = compareA?.value; const previousB = compareB?.value;
      const makeOptions = () => snapshotOptions.map((snapshot) => { const option = document.createElement('option'); option.value = snapshot.id; option.textContent = `${snapshot.id} · ${snapshot.reason || `шаг ${snapshot.sequence}`}`; return option; });
      compareA?.replaceChildren(...makeOptions()); compareB?.replaceChildren(...makeOptions());
      if (compareA && snapshotOptions.length) compareA.value = snapshotOptions.some((item) => item.id === previousA) ? previousA : snapshotOptions[Math.max(0, snapshotOptions.length - 2)].id;
      if (compareB && snapshotOptions.length) compareB.value = snapshotOptions.some((item) => item.id === previousB) ? previousB : snapshotOptions.at(-1).id;
      const graph = content.querySelector('.disput-graf'); if (graph) graph.style.zoom = String(zoom);
      panel.querySelector('[data-map-zoom="reset"]').textContent = `${Math.round(zoom * 100)}%`;
      if (selectedId) { const item = findItem(map, selectedId); drawer.hidden = !item; drawer.innerHTML = drawerHtml(item, map); }
      requestAnimationFrame(drawLinks);
      return map;
    };
    const render = (aggregate) => {
      if (aggregate !== undefined) pendingAggregate = aggregate;
      if (!panel.classList.contains('is-open')) return map;
      return renderWorkspace();
    };
    const setOpen = (open) => {
      panel.classList.toggle('is-open', open);
      header.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      if (open) renderWorkspace();
    };
    const handleOutsideClick = (event) => {
      if (!panel.classList.contains('is-open') || panel.contains(event.target)) return;
      setOpen(false);
    };
    const refreshRuns = async () => {
      const ids = await options.caseStore?.list?.() || [];
      const current = runSelect.value;
      runSelect.replaceChildren(...['', ...ids].map((id) => { const option = document.createElement('option'); option.value = id; option.textContent = id || 'Текущее дело'; return option; }));
      if ([...runSelect.options].some((option) => option.value === current)) runSelect.value = current;
    };
    header.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
    close.addEventListener('click', () => setOpen(false));
    document.addEventListener('click', handleOutsideClick);
    panel.addEventListener('click', (event) => {
      const modeButton = event.target.closest('[data-map-mode]'); if (modeButton) { mode = modeButton.dataset.mapMode; render(); return; }
      const expand = event.target.closest('[data-map-expand]'); if (expand) { const paragraph = expand.previousElementSibling; const collapsed = paragraph?.classList.toggle('is-collapsed'); expand.textContent = collapsed ? 'Показать полностью' : 'Свернуть'; return; }
      if (event.target.closest('[data-map-compare-close]')) { comparison = null; map = caseMap; render(); return; }
      if (event.target.closest('[data-map-compare]')) { const from = caseMap.snapshots?.find((item) => item.id === compareA?.value); const to = caseMap.snapshots?.find((item) => item.id === compareB?.value); if (from && to) { comparison = root.DebateStateMap.compareSnapshots(from, to); const snapshotMap = root.DebateStateMap.project({ runId: caseMap.runId, status: 'snapshot', currentStageId: `snapshot:${to.sequence}`, config: { topic: caseMap.title }, executionPlan: { profileId: caseMap.profileId }, protocolState: { registry: { artifacts: to.artifacts } } }); map = Object.freeze({ ...snapshotMap, snapshots: caseMap.snapshots, diff: comparison }); render(); } return; }
      const filterButton = event.target.closest('[data-map-filter]'); if (filterButton) { filter = filterButton.dataset.mapFilter; render(); return; }
      if (event.target.closest('[data-map-reset]')) { filter = 'all'; search.value = ''; render(); return; }
      const zoomButton = event.target.closest('[data-map-zoom]'); if (zoomButton) { zoom = zoomButton.dataset.mapZoom === 'reset' ? 1 : Math.max(.6, Math.min(1.6, zoom + (zoomButton.dataset.mapZoom === 'in' ? .1 : -.1))); render(); return; }
      if (event.target.closest('[data-map-drawer-close]')) { selectedId = ''; drawer.hidden = true; return; }
      const linkRemove = event.target.closest('[data-map-link-remove]'); if (linkRemove) { event.preventDefault(); event.stopPropagation(); void options.onLinkRemove?.({ linkId: linkRemove.dataset.mapLinkRemove, item: findItem(map, linkRemove.dataset.mapLinkRemove) }); return; }
      const source = event.target.closest('[data-map-source]'); if (source) { const turnId = source.dataset.mapSource; const target = document.querySelector(`[data-turn-id="${CSS.escape(turnId)}"], [data-message-id="${CSS.escape(turnId)}"], [data-entry-id="${CSS.escape(turnId)}"]`); target?.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); target?.focus?.(); target?.classList.add('is-focused'); setTimeout(() => target?.classList.remove('is-focused'), 1600); return; }
      const humanAction = event.target.closest('[data-map-human-action]'); if (humanAction) { options.onHumanAction?.({ action: humanAction.dataset.mapHumanAction, itemId: humanAction.dataset.itemId, item: findItem(map, humanAction.dataset.itemId) }); return; }
      const axisButton = event.target.closest('[data-map-axis]'); if (axisButton) { selectedId = axisButton.dataset.mapAxis; drawer.innerHTML = drawerHtml(findItem(map, selectedId), map); drawer.hidden = false; return; }
      const decisionOption = event.target.closest('[data-map-decision-option]'); if (decisionOption) { const detail = { requestId: decisionOption.dataset.requestId, optionId: decisionOption.dataset.mapDecisionOption }; void options.onDecisionResolved?.(detail); panel.dispatchEvent(new CustomEvent('disput:decision-resolved', { bubbles: true, detail })); return; }
      const decision = event.target.closest('[data-map-trigger-decision]'); if (decision) { panel.dispatchEvent(new CustomEvent('disput:trigger-decision', { bubbles: true, detail: { taskId: decision.dataset.taskId, approved: decision.dataset.mapTriggerDecision === 'approve' } })); return; }
      if (event.target.closest('[data-map-export]')) { const blob = new Blob([JSON.stringify(map, null, 2)], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `disput-state-map-${map.runId || 'idle'}.json`; link.click(); URL.revokeObjectURL(link.href); return; }
      if (event.target.closest('[data-case-export]')) { const serialized = options.caseStore?.exportCase?.(); if (!serialized) return; const blob = new Blob([serialized], { type: 'application/json' }); const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `disput-case-${map.runId || 'case'}.json`; link.click(); URL.revokeObjectURL(link.href); return; }
      if (event.target.closest('[data-case-import-action]')) { caseImport?.click(); return; }
      if (event.target.closest('[data-case-delete]')) { const id = runSelect.value || options.caseStore?.getState?.()?.caseId; if (id) { void options.caseStore?.remove?.(id).then(() => { runSelect.value = ''; render(options.getAggregate?.()); }); } return; }
      const focus = event.target.closest('[data-map-focus]'); if (focus) { const target = content.querySelector(`[data-map-item="${CSS.escape(focus.dataset.mapFocus)}"]`); target?.scrollIntoView?.({ block: 'center', inline: 'center' }); target?.classList.add('is-focused'); setTimeout(() => target?.classList.remove('is-focused'), 1500); return; }
      const itemCard = event.target.closest('[data-map-item]'); if (itemCard) { selectedId = itemCard.dataset.mapItem; drawer.innerHTML = drawerHtml(findItem(map, selectedId), map); drawer.hidden = false; return; }
    });
    panel.addEventListener('keydown', (event) => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-map-item]')) { event.preventDefault(); event.target.click(); } if (event.key === 'Escape') { selectedId = ''; drawer.hidden = true; } });
    search.addEventListener('input', () => render());
    runSelect.addEventListener('change', async () => { if (!runSelect.value) { render(options.getAggregate?.()); return; } const saved = await options.caseStore?.load?.(runSelect.value); if (saved) render(saved); });
    caseImport?.addEventListener('change', async () => { try { const serialized = await caseImport.files?.[0]?.text?.(); if (serialized) { const imported = await options.caseStore?.importCase?.(serialized); await refreshRuns(); runSelect.value = imported.caseId; render(imported); } } finally { caseImport.value = ''; } });
    options.caseStore?.subscribe?.(() => { void refreshRuns(); });
    void refreshRuns();
    render(options.aggregate || options.getAggregate?.());
    return Object.freeze({ render, getMap: () => map, refreshRuns, open: () => setOpen(true), close: () => setOpen(false) });
  }

  const api = Object.freeze({ init });
  root.DisputStateMapView = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
