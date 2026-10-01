// shared/message-delivery-view.js
// Telemetry window → Automation tab: delivery health, batches, problems with next steps,
// every message's timeline (request id, dispatch phases, completion), per-model matrix,
// raw journal and a JSON report. Style follows the Disput tab.
(function initMessageDeliveryView(root) {
  'use strict';

  const KEY = () => root.MessageDelivery?.JOURNAL_KEY || 'messageDelivery.journal';
  const $ = (id) => document.getElementById(id);
  const RESULT = {
    delivered: 'доставлено ✓', partial: 'неполный', no_token: 'без метки', empty: 'пустой ответ', no_answer: 'нет ответа',
    not_submitted: 'не отправлен', no_tab: 'нет вкладки', error: 'ошибка', cancelled: 'отменён', waiting: 'ждём…'
  };
  const OUTCOME = { settled: 'завершён', timeout: 'таймаут', cancelled: 'отменён', rejected: 'не стартовал', moderator_closed: 'закрыт модератором' };
  const RUN_MODE = { auto: 'авто', semi_auto: 'полуавтомат', manual_dispatch: 'ручная отправка' };
  const PHASE = {
    dispatch_started: 'отправка', command_accepted: 'команда принята', submitted: 'отправлено',
    bottom_nudge: 'передёрнули вниз', bottom_nudge_skipped: 'передёргивание невозможно', commit_not_final: 'фиксация не стала финалом', incomplete_answer_committed: 'неполный ответ зафиксирован', static_answer_committed: 'текст зафиксирован после визитов',
    submit_unconfirmed: 'отправка не подтверждена', command_not_delivered: 'команда не доставлена', blocked: 'заблокировано',
    terminal_deferred: 'финал отложен', terminal_deferral_ended: 'отсрочка финала закончилась'
  };
  const SEV = { critical: 'Критично', warning: 'Внимание', info: 'Инфо' };
  const time = (at) => (at ? new Date(at).toLocaleTimeString() : '—');
  const secs = (ms) => (ms == null ? '—' : ms < 1000 ? `${ms} мс` : `${(ms / 1000).toFixed(1)} с`);
  const shortId = (id) => (id ? String(id).replace(/^treq-/, '').slice(0, 8) : '—');
  const join = (parts, sep = ' · ') => parts.filter((part) => part != null && part !== false && part !== '').join(sep);

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
    const diagnosis = root.MessageDeliveryDiagnosis.diagnose(journal, { version: root.chrome?.runtime?.getManifest?.().version || null });
    const keep = (item) => model === 'all' || item.model === model;
    return {
      journal, diagnosis,
      sends: diagnosis.sends.filter((s) => keep(s) && (!only || s.result !== 'delivered' || s.stale || s.rejections.length)),
      batches: diagnosis.batches.filter((b) => (model === 'all' || b.models.includes(model)) && (!only || b.outcome !== 'settled' || b.refusals.length)),
      problems: diagnosis.problems.filter((p) => model === 'all' || !p.model || p.model === model),
      matrix: diagnosis.matrix.filter(keep),
      raw: journal.filter((e) => model === 'all' || !e.model || e.model === model || (e.models || []).includes(model))
    };
  }

  function dispatchPath(send) {
    if (!send.dispatch.length) return null;
    return send.dispatch.map((d) => join([PHASE[d.phase] || d.phase, d.ms != null ? secs(d.ms) : null, d.reason ? `(${d.reason})` : null], ' ')).join(' → ');
  }

  function sendRow(send) {
    const flow = join([
      send.tab != null ? `вкладка ${send.tab}` : 'вкладки нет',
      dispatchPath(send),
      send.statuses.length ? send.statuses.join(' → ') : null,
      send.navigations.length ? send.navigations.map((n) => `навигация ${n.from} → ${n.to}${n.ms != null ? ` ${secs(n.ms)}` : ''}`).join(' → ') : null,
      send.completionTerminals.length ? send.completionTerminals.map((c) => `протокол: ${c.status}${c.reason ? ` (${c.reason})` : ''}${c.ms != null ? ` ${secs(c.ms)}` : ''}`).join(' → ') : null,
      send.firstTextMs != null ? `текст через ${secs(send.firstTextMs)}` : 'текста нет',
      send.textProgress ? `рос до ${send.textProgress.chars} симв. к ${secs(send.textProgress.ms)}` : null,
      send.focus.count ? `фокус ×${send.focus.count}${Object.keys(send.focus.sources).length ? ` (${Object.entries(send.focus.sources).map(([name, n]) => `${name} ${n}`).join(', ')})` : ''}` : null,
      send.lateText ? `текст после финала: ${send.lateText.chars} симв. через ${secs(send.lateText.ms)}` : null,
      send.providerStop ? `стоп: ${send.providerStop.stopped ? 'подтверждён' : send.providerStop.reason}` : null
    ]);
    const t = send.terminal;
    const end = t ? join([
      secs(t.ms),
      t.chars != null ? `${t.chars} симв.` : null,
      t.status || null,
      t.completion || null,
      t.source && t.source !== 'live' ? t.source : null,
      t.reason || null,
      t.detail || null,
      send.revisions ? `ревизий: ${send.revisions}` : null,
      send.replacedUnproven ? `заменён полным ответом с меткой: ${send.replacedUnproven.previousChars} → ${send.replacedUnproven.chars} симв.` : null,
      send.rejections.length ? `отклонено: ${send.rejections.length}` : null
    ]) : '—';
    const dispatchTail = send.dispatchIds.map((id) => String(id).split(':').pop()).join(',');
    const ids = `${shortId(send.requestId)}${dispatchTail ? ` / #${dispatchTail}` : ''}`;
    const row = el('tr', null,
      el('td', null, time(send.at)),
      el('td', { title: send.prompt ? `Prompt:\n${send.prompt}` : null }, send.model),
      el('td', { title: [send.requestId, ...send.dispatchIds].filter(Boolean).join('\n') }, ids),
      el('td', null, send.batchId || '—'),
      el('td', null, flow),
      el('td', { title: t?.answer ? `Answer:\n${t.answer}` : null }, end),
      el('td', null, send.prematureTerminal ? `${RESULT[send.result] || send.result} · финал преждевременный` : (RESULT[send.result] || send.result)));
    if (send.prematureTerminal || !['delivered', 'waiting', 'cancelled'].includes(send.result)) row.style.color = 'var(--danger, #b42318)';
    return row;
  }

  function batchRow(batch) {
    const refusalReasons = [...new Set(batch.refusals.map((r) => join([r.reason || r.errorCode, r.blockingModel], ' ')))].join(', ');
    const start = join([
      batch.refusals.length ? `отказов: ${batch.refusals.length} (${refusalReasons})` : null,
      batch.accepted ? `${batch.accepted.confirmed ? 'принят' : 'без подтверждения'} через ${secs(batch.accepted.waitedMs)}` : null
    ]) || '—';
    const answered = Object.entries(batch.completion || {}).map(([model, completion]) => `${model}: ${completion}`).join(', ');
    const end = join([
      batch.durationMs != null ? secs(batch.durationMs) : null,
      batch.timeoutMs != null ? `срок ${secs(batch.timeoutMs)}` : null,
      batch.missing?.length ? `без ответа: ${batch.missing.join(', ')}` : null,
      batch.skipped?.length ? `пропущены модератором: ${batch.skipped.join(', ')}` : null,
      answered || null,
      batch.reason || null
    ]) || '—';
    const stage = join([batch.stageAttemptId || batch.batchId, RUN_MODE[batch.runMode] || null, batch.template ? `шаблон ${batch.template}` : null, batch.judge ? 'judge' : null, batch.manual ? 'moderator' : null, batch.generationProfile]);
    const row = el('tr', null,
      el('td', null, time(batch.at)),
      el('td', null, stage || '—'),
      el('td', null, batch.models.join(', ') || '—'),
      el('td', null, start),
      el('td', null, OUTCOME[batch.outcome] || batch.outcome || 'идёт…'),
      el('td', null, end));
    if (['timeout', 'rejected'].includes(batch.outcome)) row.style.color = 'var(--danger, #b42318)';
    return row;
  }

  async function render() {
    const panel = $('automation-tabpanel');
    if (!panel || panel.hidden) return;
    const journal = await readJournal();
    const view = filtered(journal);
    const models = [...new Set(view.diagnosis.sends.map((s) => s.model).filter(Boolean))];
    const select = $('automation-model-filter');
    const current = select.value;
    select.replaceChildren(new Option('All models', 'all'), ...models.map((m) => new Option(m, m)));
    select.value = models.includes(current) ? current : 'all';

    const all = view.diagnosis.sends;
    const count = (result) => all.filter((s) => s.result === result).length;
    const crit = view.diagnosis.problems.filter((p) => p.severity === 'critical').length;
    $('automation-status').textContent = all.length
      ? `${all.length} sent · ${count('delivered')} delivered · ${count('partial')} partial · ${count('waiting')} waiting · ${crit} critical`
      : '';

    $('automation-health').replaceChildren(all.length ? table(
      ['Model', 'Sent', 'Delivered', 'Partial', 'No token', 'Empty', 'No answer', 'Not submitted', 'No tab', 'Error', 'Cancelled', 'Premature final', 'Rejected', 'Stale dropped', 'Focus moves', 'Median submit', 'Median answer'],
      view.matrix.map((r) => el('tr', null,
        el('td', null, r.model), el('td', null, r.sent), el('td', null, r.delivered), el('td', null, r.partial),
        el('td', null, r.no_token), el('td', null, r.empty), el('td', null, r.no_answer), el('td', null, r.not_submitted),
        el('td', null, r.no_tab), el('td', null, r.error), el('td', null, r.cancelled), el('td', null, r.premature), el('td', null, r.rejected),
        el('td', null, r.stale), el('td', null, r.focus), el('td', null, secs(r.medianSubmitMs)), el('td', null, secs(r.medianMs)))))
      : empty('No messages yet.'));

    $('automation-batches')?.replaceChildren(view.batches.length
      ? table(['Started', 'Stage', 'Models', 'Start', 'Outcome', 'Finish'], view.batches.slice().reverse().map(batchRow))
      : empty(view.diagnosis.batches.length ? 'Nothing matches the filter.' : 'No batches yet.'));

    $('automation-problems').replaceChildren(view.problems.length
      ? el('div', null, view.problems.map((p) => el('div', { class: 'ad-problem', 'data-severity': p.severity },
        el('div', { class: 'ad-problem-head' },
          el('strong', null, `[${SEV[p.severity]}] ${p.title}`),
          el('span', { class: 'devtools-meta' }, ` ${join([time(p.at), p.ageMs != null ? `${secs(p.ageMs)} назад` : null, p.batchId, p.count > 1 ? `×${p.count}` : null, p.reason])}`)),
        el('div', null, p.detail),
        p.hint ? el('div', { class: 'ad-hint' }, `Что делать: ${p.hint}`) : null)))
      : empty(all.length ? 'No problems.' : 'No diagnoses yet.'));

    $('automation-messages').replaceChildren(view.sends.length
      ? table(['Sent', 'Model', 'Request / dispatch', 'Batch', 'Path', 'Finish', 'Result'], view.sends.slice().reverse().map(sendRow))
      : empty(all.length ? 'Nothing matches the filter.' : 'No messages yet.'));

    $('automation-raw').replaceChildren(view.raw.length
      ? table(['Time', 'Model', 'Event', 'Details'], view.raw.slice().reverse().map((e) => {
        const { at, model, kind, token, ...rest } = e;
        return el('tr', null, el('td', null, time(at)), el('td', null, model || ''), el('td', null, kind), el('td', null, `${token || ''} ${JSON.stringify(rest).slice(0, 300)}`));
      }))
      : empty('No journal events.'));
  }

  async function report() {
    const journal = await readJournal();
    const text = JSON.stringify({
      report: 'message-delivery',
      generated_at: new Date().toISOString(),
      extension_version: root.chrome?.runtime?.getManifest?.().version,
      transport_contract_version: root.TransportContract?.VERSION || null,
      diagnosis: root.MessageDeliveryDiagnosis.diagnose(journal, { version: root.chrome?.runtime?.getManifest?.().version || null }),
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
