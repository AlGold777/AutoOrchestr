// Стенд схем прототипа холста Basic: клавиша I (или Ш) открывает окно вставки JSON-схемы этапов,
// «Применить» проверяет схему и перерисовывает холст по ней. Раунды и синтезы схемы кладутся в
// window.ProtoState, поэтому их окна — настоящие окна cards.js; остальные блоки — окна «Из схемы».
// Холст (canvas.js) отдаёт отрисовку сюда, пока ProtoStand.active; «Сбросить» возвращает исходный холст.
(function initProtoStand(root) {
  'use strict';

  const STAND_VERSION = '1';
  const S = () => root.ProtoState;
  const cards = () => root.ProtoCards || {};
  const canvas = () => root.ProtoCanvas || {};
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const own = (value) => typeof value === 'string' && Boolean(value.trim());
  const cut = (text, n) => { const s = String(text || '').trim().replace(/\s+/g, ' '); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  // ---------- Формат схемы ----------
  const COMMON = ['id', 'block', 'title', 'inputs', 'artifacts', 'repeats', 'because', 'why'];
  const FIELDS = {
    round: ['models', 'order', 'task'], synthesis: ['model', 'role', 'task'], gate: ['criteria'], route: ['choices'],
    owner: ['ask'], form: ['purpose'], source: ['kind'], file: ['file', 'mode'], list: ['from', 'rule'],
    foreach: ['over', 'body'], block: ['name'], assemble: ['template'], score: ['criteria', 'weights']
  };
  const KIND = {
    round: ['Раунд', 'ti-users'], synthesis: ['Синтез', 'ti-git-merge'], gate: ['Проверка', 'ti-shield-check'], route: ['Развилка', 'ti-arrows-split'],
    owner: ['Владелец', 'ti-user'], form: ['Форма', 'ti-forms'], source: ['Источник', 'ti-file-text'], file: ['Файл', 'ti-file-export'],
    list: ['Список', 'ti-list'], foreach: ['Каждый', 'ti-repeat'], block: ['Блок', 'ti-box'], assemble: ['Сборка', 'ti-stack-2'], score: ['Оценка', 'ti-star']
  };
  const ENUMS = { order: ['parallel', 'sequential'], kind: ['text', 'document', 'link'], mode: ['overwrite', 'append', 'read'] };
  const LABELS = {
    id: 'этап', block: 'блок', title: 'название', why: 'зачем', inputs: 'вход', artifacts: 'артефакты', repeats: 'повтор', because: 'условие повтора',
    models: 'модели', order: 'порядок', task: 'задание', model: 'модель', role: 'роль', criteria: 'критерии', choices: 'варианты', ask: 'вопрос',
    purpose: 'цель', kind: 'вид', file: 'файл', mode: 'режим', from: 'из', rule: 'правило', over: 'по', body: 'тело', name: 'имя',
    template: 'шаблон', weights: 'веса'
  };
  const ORDER_TEXT = { parallel: 'параллельно', sequential: 'по очереди' };
  // Роли окна модели (cards.js, ROLES) по словам схемы.
  const ROLE_IDS = [
    [/свод|свести|синтез|synth/i, 'interaction_meta_synthesis'],
    [/крит|аудит|critique/i, 'interaction_critical_audit'],
    [/отобр|идеи|select/i, 'interaction_select_ideas'],
    [/групп|кластер|cluster/i, 'interaction_pattern_clustering']
  ];
  const ROLE_OPTIONS = [['None', 'None'], ['interaction_meta_synthesis', 'Synthes'], ['interaction_critical_audit', 'Critique'],
    ['interaction_select_ideas', 'Select ideas'], ['interaction_pattern_clustering', 'Clustering'], ['custom', 'Custom']];
  const roleIdOf = (text) => (own(text) ? (ROLE_IDS.find(([re]) => re.test(text))?.[1] || '') : '');

  const refId = (ref) => String(ref).split('.')[0];
  const listOf = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);

  // ---------- Проверка ----------
  // Возвращает { schema, flat, issues }; schema = null, если JSON не читается.
  function validate(text) {
    const issues = [];
    const add = (level, step, msg) => issues.push({ level, step, msg });
    let schema;
    try { schema = JSON.parse(text); } catch (error) { add('error', null, `Неверный JSON: ${error.message}`); return { schema: null, flat: [], issues }; }
    if (!schema || typeof schema !== 'object' || Array.isArray(schema)) { add('error', null, 'Схема должна быть объектом { task, steps }.'); return { schema: null, flat: [], issues }; }
    Object.keys(schema).filter((k) => !['task', 'steps'].includes(k)).forEach((k) => add('warn', null, `Неизвестное поле схемы «${k}».`));
    if (!own(schema.task)) add('warn', null, 'Нет task — фразы задачи.');
    if (!Array.isArray(schema.steps) || !schema.steps.length) { add('error', null, 'steps должен быть непустым списком этапов.'); return { schema: null, flat: [], issues }; }

    // Порядок проверки ссылок: этапы списка, тело foreach — сразу после самого foreach.
    const flat = [];
    const walk = (steps, parent) => steps.forEach((step, i) => {
      const entry = { step: step && typeof step === 'object' && !Array.isArray(step) ? step : {}, key: '', pos: flat.length, parent, raw: step };
      entry.key = own(entry.step.id) ? entry.step.id : `${parent ? `${parent.key}.body` : 'steps'}[${i}]`;
      flat.push(entry);
      if (entry.step.block === 'foreach' && Array.isArray(entry.step.body)) walk(entry.step.body, entry);
    });
    walk(schema.steps, null);
    // Повтор наследует настройки повторяемого этапа: models, model, order, role, если у него их нет.
    const firstById = new Map();
    flat.forEach((e) => { if (own(e.step.id) && !firstById.has(e.step.id)) firstById.set(e.step.id, e); });
    flat.forEach((e) => {
      const src = own(e.step.repeats) ? firstById.get(e.step.repeats) : null;
      if (!src || src.pos >= e.pos || src.step.block !== e.step.block) return;
      ['models', 'model', 'order', 'role'].forEach((k) => {
        if (e.step[k] == null && src.step[k] != null) { e.step[k] = JSON.parse(JSON.stringify(src.step[k])); (e.inherited = e.inherited || []).push(k); }
      });
    });
    const byId = new Map();
    flat.forEach((e) => {
      const st = e.step;
      if (e.raw !== st) { add('error', e.key, 'Этап должен быть объектом.'); return; }
      if (!own(st.id)) add('error', e.key, 'Нет id.');
      else if (byId.has(st.id)) add('error', e.key, `id «${st.id}» повторяется.`);
      else byId.set(st.id, e);
      if (!FIELDS[st.block]) add('error', e.key, st.block ? `Неизвестный блок «${st.block}».` : 'Нет block.');
      if (!own(st.title)) add('error', e.key, 'Нет title.');
      if (!own(st.why)) add('error', e.key, 'Нет why — зачем этот этап.');
      if (FIELDS[st.block]) {
        Object.keys(st).filter((k) => !COMMON.includes(k) && !FIELDS[st.block].includes(k) && !(st.block === 'source' && k === 'title'))
          .forEach((k) => add('warn', e.key, `Неизвестное поле «${k}» для блока ${st.block}.`));
      }
      Object.entries(ENUMS).forEach(([k, values]) => {
        if (st[k] != null && FIELDS[st.block]?.includes(k) && !values.includes(st[k])) add('warn', e.key, `${k}: «${st[k]}» — ожидается ${values.join(' | ')}.`);
      });
      ['inputs', 'artifacts'].forEach((k) => { if (st[k] != null && !Array.isArray(st[k])) add('error', e.key, `${k} должен быть списком.`); });
      if (st.block === 'round' && (!Array.isArray(st.models) || !st.models.length)) add('error', e.key, 'У раунда нет models.');
      if (st.block === 'round' && Array.isArray(st.models)) st.models.forEach((m, i) => { if (!own(m?.name)) add('error', e.key, `models[${i}]: нет name.`); });
      if (st.block === 'synthesis' && !own(st.model)) add('warn', e.key, 'У синтеза нет model.');
      if (st.block === 'route' && !Array.isArray(st.choices)) add('error', e.key, 'У route нет choices.');
      if (st.block === 'foreach' && !Array.isArray(st.body)) add('error', e.key, 'У foreach нет body (списка этапов).');
      if (own(st.repeats) && !own(st.because)) add('error', e.key, `Повтор ${st.repeats} без because.`);
      if (own(st.because) && !own(st.repeats)) add('warn', e.key, 'because без repeats.');
    });
    // Ссылки: вверх — inputs/repeats/over/from; вниз — route.goes.
    flat.forEach((e) => {
      const st = e.step;
      const refs = [];
      if (Array.isArray(st.inputs)) st.inputs.forEach((r) => refs.push(['inputs', r, 'up']));
      if (st.repeats != null) refs.push(['repeats', st.repeats, 'up']);
      if (st.block === 'foreach' && st.over != null) refs.push(['over', st.over, 'up']);
      if (st.block === 'list' && st.from != null) refs.push(['from', st.from, 'up']);
      if (st.block === 'route' && Array.isArray(st.choices)) st.choices.forEach((c) => listOf(c?.goes).forEach((r) => refs.push(['goes', r, 'down'])));
      refs.forEach(([field, ref, dir]) => {
        if (!own(ref)) { add('error', e.key, `${field}: пустая ссылка.`); return; }
        if (refId(ref) === 'item') {
          if (field === 'inputs' && e.parent) return;
          add('error', e.key, `${field}: «item» можно только в inputs этапов внутри body у foreach.`);
          return;
        }
        const target = byId.get(refId(ref));
        if (!target) { add('error', e.key, `${field}: этапа «${refId(ref)}» нет.`); return; }
        if (dir === 'up' && target.pos >= e.pos) add('error', e.key, `${field}: «${ref}» — ссылка ${target.pos === e.pos ? 'на себя' : 'вниз'}; можно только на этапы выше.`);
        if (dir === 'down' && target.pos <= e.pos) add('error', e.key, `goes: «${ref}» — переход назад; route ведёт только к этапам ниже.`);
        if (field === 'repeats' && target.step.block !== st.block) add('warn', e.key, `repeats: ${ref} — блок ${target.step.block}, а этот ${st.block}.`);
        const dot = String(ref).indexOf('.');
        if (dot > 0) {
          const name = String(ref).slice(dot + 1);
          if (!listOf(target.step.artifacts).includes(name)) add('error', e.key, `${field}: у ${refId(ref)} нет артефакта «${name}» в artifacts.`);
        }
      });
    });
    return { schema, flat, issues };
  }

  // ---------- Состояние стенда ----------
  const DATA_KEYS = ['models', 'defaults', 'run', 'rounds', 'final', 'selectedModel'];
  const stand = { active: false, layout: [], issues: [], flat: [], schema: null, snapshot: null, name: null, current: null, text: '' };

  // Схема → ProtoState: раунды и синтезы в порядке списка; layout — колонки холста.
  function applySchema(schema, flat, issues) {
    const state = S();
    if (!stand.snapshot) {
      stand.snapshot = JSON.parse(JSON.stringify(DATA_KEYS.reduce((o, k) => ({ ...o, [k]: state[k] }), {})));
      stand.name = $('currentPipelineName')?.textContent || 'Default';
    }
    const steps = schema.steps.filter((st) => st && typeof st === 'object');
    const names = new Set(stand.snapshot.models);
    steps.forEach((st) => { listOf(st.models).forEach((m) => own(m?.name) && names.add(m.name)); if (own(st.model)) names.add(st.model); });
    state.models = [...names];
    state.rounds = [];
    const lastSynth = steps.map((st) => st.block).lastIndexOf('synthesis');
    const finalAt = lastSynth >= 0 && !steps.slice(lastSynth + 1).some((st) => st.block === 'round') ? lastSynth : -1;
    let final = null;
    stand.layout = steps.map((st, i) => {
      const col = { step: st, key: flat.find((e) => e.raw === st)?.key || st.id };
      if (st.block === 'round') {
        const index = state.rounds.length;
        const inputs = listOf(st.inputs);
        state.rounds.push({
          ref: own(st.id) ? st.id : `r${index + 1}`,
          order: ENUMS.order.includes(st.order) ? st.order : '',
          input: inputs.length ? (inputs.length > 1 ? 'all' : 'previous') : (index === 0 ? '' : 'none'),
          task: own(st.task) ? st.task : '', role: 'None',
          models: listOf(st.models).filter((m) => m && typeof m === 'object').map((m) => {
            const id = roleIdOf(m.role);
            const roleLine = own(m.role) && !id ? `Роль: ${m.role.trim()}.` : '';
            return { name: String(m.name || '?'), enabled: true, send: true, role: id || 'None', schemaRole: own(m.role) ? m.role.trim() : '',
              task: [roleLine, own(m.task) ? m.task.trim() : ''].filter(Boolean).join('\n\n'), request: '', maxWords: '', discipline: state.emptyDiscipline() };
          }),
          intermediateSynthesis: null,
          artifacts: listOf(st.artifacts).map((title, k) => ({ id: `${st.id}-a${k + 1}`, title: String(title), version: 1 }))
        });
        col.round = index;
      } else if (st.block === 'synthesis') {
        col.synth = { model: own(st.model) ? st.model : (state.models.includes('Claude') ? 'Claude' : state.models[0]),
          task: [own(st.role) ? `Роль: ${st.role.trim()}.` : '', own(st.task) ? st.task.trim() : ''].filter(Boolean).join('\n\n'),
          request: '', discipline: state.emptyDiscipline() };
        col.after = state.rounds.length - 1; // раунд, после которого стоит синтез (−1 — раундов выше нет)
        if (i === finalAt) { col.final = true; col.synth.on = true; final = col.synth; }
      }
      return col;
    });
    state.final = final || { on: false, model: state.models.includes('Claude') ? 'Claude' : state.models[0], task: '', discipline: state.emptyDiscipline() };
    stand.schema = schema;
    stand.flat = flat;
    stand.issues = issues;
    stand.active = true;
    const name = $('currentPipelineName');
    if (name) { name.textContent = own(schema.task) ? cut(schema.task, 60) : 'Схема'; name.title = schema.task || ''; }
    render();
  }

  function reset() {
    const state = S();
    if (stand.snapshot) DATA_KEYS.forEach((k) => { state[k] = stand.snapshot[k]; });
    const name = $('currentPipelineName');
    if (name && stand.name != null) { name.textContent = stand.name; name.title = ''; }
    Object.assign(stand, { active: false, layout: [], issues: [], flat: [], schema: null, snapshot: null, name: null, current: null });
    canvas().render?.();
    drawIssues();
  }

  // ---------- Холст ----------
  const issuesOf = (key) => stand.issues.filter((it) => it.step === key);
  const bang = (key) => {
    const list = issuesOf(key);
    if (!list.length) return '';
    const err = list.some((it) => it.level === 'error');
    return `<span class="proto-stand-bang${err ? '' : ' is-warn'}" title="${esc(list.map((it) => it.msg).join('\n'))}">!</span>`;
  };
  const inputsText = (st, skip) => {
    const rest = listOf(st.inputs).filter((r) => refId(r) !== skip);
    return rest.length ? `<div class="proto-stand-line">вход: ${esc(rest.join(', '))}</div>` : '';
  };
  const repeatText = (st) => (own(st.repeats) ? `<div class="proto-stand-line proto-stand-repeat">повтор ${esc(st.repeats)}${own(st.because) ? ` · ${esc(st.because)}` : ''}</div>` : '');
  const artifactsHtml = (list) => {
    const items = list.length
      ? list.map((t) => `<span class="proto-artifact" title="${esc(t)} v1"><span class="proto-artifact-title">${esc(t)}</span><span class="proto-artifact-version">v1</span></span>`).join('')
      : '<span class="proto-artifacts-empty">—</span>';
    return `<div class="proto-artifacts" aria-disabled="true"><div class="proto-artifacts-label">Артефакты</div><div class="proto-artifacts-row">${items}</div></div>`;
  };
  const modelBlock = (model, index) => {
    const on = model.enabled !== false;
    const send = on && model.send !== false;
    const options = ROLE_OPTIONS.map(([value, label]) => {
      const text = value === 'None' && model.schemaRole && !roleIdOf(model.schemaRole) ? model.schemaRole : label;
      return `<option value="${esc(value)}"${(model.role || 'None') === value ? ' selected' : ''}>${esc(text)}</option>`;
    }).join('');
    return `<div class="model-block ${on ? 'active' : 'inactive'} with-role" data-index="${index}" data-model="${esc(model.name)}">
        <div class="model-header">
          <span class="status-indicator" data-llm-name="${esc(model.name)}"></span>
          <input type="checkbox" class="model-checkbox model-input-checkbox"${on ? ' checked' : ''} aria-label="Input" title="Input">
          <span class="model-name" title="${esc(model.schemaRole ? `${model.name} — ${model.schemaRole}` : model.name)}">${esc(model.name)}</span>
          <input type="checkbox" class="model-checkbox model-send-checkbox"${send ? ' checked' : ''}${on ? '' : ' disabled'} aria-label="Send" title="Send">
        </div>
        <select class="role-selector judge-prompt-selector"${on ? '' : ' disabled'}>${options}</select>
      </div>`;
  };
  const nestedHtml = (body) => `<details class="proto-stand-body"><summary>Этапы: ${listOf(body).length}</summary>${listOf(body).map((sub) => {
    const key = stand.flat.find((e) => e.raw === sub)?.key || '';
    return `<div class="proto-stand-sub" data-stand-key="${esc(key)}" title="Двойной клик — поля этапа">${esc(sub?.id || '?')} · ${esc(KIND[sub?.block]?.[0] || sub?.block || '?')} — ${esc(cut(sub?.title, 40))}${bang(key)}</div>`;
  }).join('')}</details>`;

  function columnHtml(col, k, prevId) {
    const st = col.step;
    const key = col.key;
    const stack = `stand-stack-${k}`;
    const head = (badge, extra = '') => `<div class="stage-label"><span class="round-badge${extra}">${badge}</span></div>`;
    const tail = `${repeatText(st)}${inputsText(st, prevId)}`;
    if (col.round != null) {
      const round = S().rounds[col.round];
      return `<div class="stage-column" data-round-index="${col.round}" data-stand-key="${esc(key)}">
          ${head(`R${col.round + 1}`)}
          <div class="model-stack" id="${stack}">${round.models.map(modelBlock).join('')}</div>
          <div class="proto-stand-meta">${bang(key)}<span class="proto-stand-line"><b>${esc(st.id || '')}</b> ${esc(cut(st.title, 40))}${round.order === 'sequential' ? ' · по очереди' : ''}</span>${tail}</div>
          ${artifactsHtml(listOf(st.artifacts))}
        </div>`;
    }
    if (col.synth) {
      const options = S().models.map((n) => `<option value="${esc(n)}"${n === col.synth.model ? ' selected' : ''}>${esc(n)}</option>`).join('');
      return `<div class="stage-column${col.final ? ' synthesis-capable' : ''}"${col.final ? ' id="synthesisColumn" data-stage="synthesis"' : ''} data-stand-key="${esc(key)}">
          ${head(col.final ? 'Final' : 'Синтез')}
          <div class="model-stack" id="${stack}">
            <div class="model-block pipeline-synthesis-block selected-synthesizer proto-stand-card" data-stand-key="${esc(key)}">
              <div class="model-header"><span class="status-indicator" aria-hidden="true"></span><span class="model-name">Synthesis</span>${bang(key)}</div>
              <select class="synthesis-flow-select" data-stand-key="${esc(key)}" aria-label="Модель синтеза">${options}</select>
              ${own(st.role) ? `<div class="proto-stand-line">роль: ${esc(st.role)}</div>` : ''}
            </div>
          </div>
          <div class="proto-stand-meta"><span class="proto-stand-line"><b>${esc(st.id || '')}</b> ${esc(cut(st.title, 40))}</span>${tail}</div>
          ${artifactsHtml(listOf(st.artifacts))}
        </div>`;
    }
    const [label, icon] = KIND[st.block] || [String(st.block || '?'), 'ti-help'];
    const goes = st.block === 'route' ? listOf(st.choices).map((c) => `<div class="proto-stand-line">${esc(cut(c?.when, 30))} → ${esc(listOf(c?.goes).join(', '))}</div>`).join('') : '';
    const from = st.block === 'list' && own(st.from) && refId(st.from) !== prevId ? `<div class="proto-stand-line">из: ${esc(st.from)}</div>` : '';
    const over = st.block === 'foreach' && own(st.over) && refId(st.over) !== prevId ? `<div class="proto-stand-line">по: ${esc(st.over)}</div>` : '';
    return `<div class="stage-column" data-stand-key="${esc(key)}">
        ${head(esc(label), ' proto-stand-kind')}
        <div class="model-stack" id="${stack}">
          <div class="model-block inactive proto-stand-card" data-stand-key="${esc(key)}">
            <div class="model-header"><i class="ti ${icon} proto-stand-icon" aria-hidden="true"></i><span class="model-name" title="${esc(st.title)}">${esc(st.title || '—')}</span>${bang(key)}</div>
            <div class="proto-stand-line"><b>${esc(st.id || '')}</b> ${esc(cut(st.why, 70))}</div>
            ${repeatText(st)}${goes}${from}${over}
            ${st.block === 'foreach' ? nestedHtml(st.body) : ''}
          </div>
        </div>
        <div class="proto-stand-meta">${inputsText(st, prevId)}</div>
        ${artifactsHtml(listOf(st.artifacts))}
      </div>`;
  }

  // Линия к этапу активна, если он берёт вход у соседа слева (inputs/repeats/from/over); иначе — серая.
  const linksTo = (st, id) => !!id && [...listOf(st.inputs), st.from, st.over].some((r) => own(r) && refId(r) === id);

  function render() {
    const root = $('pipelineFlow');
    if (!root) return;
    const cols = stand.layout;
    let html = `<div class="stage-column entry-column">
        <div class="stage-label"><span class="entry-badge">In</span></div>
        <div class="entry-wrapper" id="entryWrapper"><div class="entry-point" id="entryPoint" title="Общие значения" style="cursor:pointer">▶</div></div>
      </div>
      <div class="connector-group"><svg class="connector-svg" id="svg-in-models"></svg></div>`;
    cols.forEach((col, k) => {
      if (k > 0) html += `<div class="connector-group"><svg class="connector-svg" id="stand-svg-${k}"></svg></div>`;
      html += columnHtml(col, k, k > 0 ? cols[k - 1].step.id : '');
    });
    root.innerHTML = html;
    const value = $('debate-round-value');
    if (value) value.value = String(S().rounds.length);
    ['debate-round-minus-btn', 'pipeline-add-round-btn'].forEach((id) => { const b = $(id); if (b) b.disabled = true; });
    draw();
    requestAnimationFrame(draw);
  }

  function draw() {
    const panel = $('pipeline-panel');
    if (!panel || !stand.active) return;
    const cols = stand.layout;
    const blockH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pipeline-block-height')) || 64;
    let max = blockH;
    panel.querySelectorAll('#pipelineFlow .model-stack').forEach((stack) => {
      const last = stack.lastElementChild;
      if (last) max = Math.max(max, last.getBoundingClientRect().bottom - stack.getBoundingClientRect().top);
    });
    panel.querySelectorAll('#pipelineFlow .connector-svg').forEach((svg) => { svg.style.height = `${max}px`; svg.setAttribute('height', `${max}`); });
    const entry = $('entryWrapper');
    if (entry) entry.style.height = `${max}px`;
    const mode = (col, side) => (col.round != null ? side : 'all');
    if (cols.length) canvas().drawInputSplitConnector?.('svg-in-models', 'stand-stack-0', 'active', mode(cols[0], 'input'));
    for (let k = 1; k < cols.length; k++) {
      const color = linksTo(cols[k].step, cols[k - 1].step.id) ? 'brain-flow' : 'inactive';
      canvas().drawMergeSplitConnector?.(`stand-svg-${k}`, `stand-stack-${k - 1}`, `stand-stack-${k}`, color, { sourceMode: mode(cols[k - 1], 'send'), targetMode: mode(cols[k], 'input') });
    }
  }

  // ---------- Окна ----------
  const fmt = (key, value) => {
    if (value == null || value === '') return '—';
    if (key === 'models' && Array.isArray(value)) {
      return value.map((m) => (m && typeof m === 'object' ? `${m.name || '?'}${own(m.role) ? ` (роль: ${m.role})` : ''}${own(m.task) ? ` — ${m.task}` : ''}${Object.keys(m).filter((x) => !['name', 'role', 'task'].includes(x)).map((x) => `; ${x}: ${fmt(x, m[x])}`).join('')}` : String(m))).join('\n');
    }
    if (key === 'choices' && Array.isArray(value)) return value.map((c) => `когда ${c?.when || '?'} → ${listOf(c?.goes).join(', ') || '—'}`).join('\n');
    if (key === 'body' && Array.isArray(value)) return value.map((s) => `${s?.id || '?'} · ${s?.block || '?'} — ${s?.title || ''}`).join('\n');
    if (key === 'order') return `${value}${ORDER_TEXT[value] ? ` (${ORDER_TEXT[value]})` : ''}`;
    if (Array.isArray(value)) return value.map((v) => (v && typeof v === 'object' ? fmt('', v) : String(v))).join(', ');
    if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}: ${typeof v === 'object' ? fmt(k, v) : v}`).join(', ');
    return String(value);
  };
  function schemaSection(st) {
    const keys = [...COMMON.filter((k) => k in st || ['block', 'title', 'why', 'inputs', 'artifacts'].includes(k)),
      ...Object.keys(st).filter((k) => !COMMON.includes(k))];
    const issues = issuesOf(stand.flat.find((e) => e.raw === st)?.key);
    return `<div class="custom-card-marks proto-stand-schema"><strong>Из схемы</strong>
      ${issues.length ? `<div class="proto-stand-issues">${issues.map((it) => `<div class="is-${it.level}">${it.level === 'error' ? 'Ошибка' : 'Замечание'}: ${esc(it.msg)}</div>`).join('')}</div>` : ''}
      <div class="proto-stand-rows">${keys.map((k) => `<div class="proto-stand-row"><span>${esc(LABELS[k] || k)} <code>${esc(k)}</code></span><div>${esc(fmt(k, st[k]))}</div></div>`).join('')}</div>
    </div>`;
  }
  // Раздел «Из схемы» дописывается в окно cards.js и восстанавливается после его перерисовки.
  function ensureSection() {
    const cur = stand.current;
    if (!stand.active || !cur) return;
    const box = cur.where === 'stage'
      ? ($('pipeline-stage-dialog')?.open ? $('pipeline-stage-card') : null)
      : ($('pipeline-block-info-modal')?.classList.contains('is-visible') ? $('pipeline-block-info-modal').querySelector('.custom-card-body') : null);
    if (!box || box.querySelector(':scope > .proto-stand-schema')) return;
    box.insertAdjacentHTML('beforeend', schemaSection(cur.step));
  }
  new MutationObserver(ensureSection).observe(document.body, { childList: true, subtree: true });

  function infoModal() {
    let modal = $('proto-stand-info');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal pipeline-block-info-modal custom-model-card';
      modal.id = 'proto-stand-info';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = '<div class="modal-content"></div>';
      modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-stand-close]')) hide(modal); });
      document.body.appendChild(modal);
    }
    return modal;
  }
  function openInfo(st) {
    stand.current = null;
    const modal = infoModal();
    const [label, icon] = KIND[st.block] || [String(st.block || '?'), 'ti-help'];
    modal.querySelector('.modal-content').innerHTML = `
      <header class="custom-card-top custom-defaults-top">
        <h3 class="custom-card-model"><i class="ti ${icon}" aria-hidden="true"></i>${esc(st.title || st.id || '—')}<span class="custom-card-where">${esc(label)} · ${esc(st.id || '')}</span></h3>
        <button type="button" class="modal-button" data-stand-close>Закрыть</button>
      </header>
      <div class="custom-card-body">${schemaSection(st)}</div>`;
    show(modal);
  }
  const show = (modal) => { modal.style.display = 'flex'; modal.classList.add('is-visible'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open'); };
  const hide = (modal) => { modal.style.display = 'none'; modal.classList.remove('is-visible'); modal.setAttribute('aria-hidden', 'true'); if (!anyOpen()) document.body.classList.remove('modal-open'); };
  const anyOpen = () => ['pipeline-block-info-modal', 'proto-stand-info', 'proto-stand-modal'].some((id) => $(id)?.classList.contains('is-visible')) || !!$('pipeline-stage-dialog')?.open;

  const colOf = (key) => stand.layout.find((c) => c.key === key);
  const stepOf = (key) => stand.flat.find((e) => e.key === key)?.raw;
  function openSynth(col) {
    stand.current = { step: col.step, where: 'card' };
    const state = S();
    if (col.final) { state.final = col.synth; cards().openSynthesis?.('final'); return; }
    if (col.after >= 0 && col.after < state.rounds.length - 1) {
      state.rounds[col.after].intermediateSynthesis = col.synth;
      cards().openSynthesis?.('intermediate', col.after);
      return;
    }
    // Синтез без раунда перед ним (или после последнего раунда): открывается через слот финального синтеза.
    const keep = state.final;
    state.final = Object.assign(col.synth, { on: true });
    cards().openSynthesis?.('final');
    if (keep !== col.synth) state.final = keep;
  }

  const CONTROLS = 'input, select, button, option, summary';
  function bindFlow() {
    const flow = $('pipelineFlow');
    flow.addEventListener('click', (event) => {
      if (!stand.active) return;
      const t = event.target;
      const badge = t.closest('.round-badge');
      if (badge) {
        event.stopPropagation();
        event.preventDefault();
        const col = colOf(badge.closest('.stage-column')?.dataset.standKey);
        if (col?.round != null) { stand.current = { step: col.step, where: 'stage' }; cards().openRound?.(col.round); }
        return;
      }
      if (t.closest('#entryPoint')) { event.stopPropagation(); stand.current = null; cards().openEntry?.(); }
    }, true);
    flow.addEventListener('dblclick', (event) => {
      if (!stand.active) return;
      const t = event.target;
      if (t.closest('select, input, button, option')) return;
      event.stopPropagation();
      const sub = t.closest('.proto-stand-sub');
      if (sub) { const st = stepOf(sub.dataset.standKey); if (st) openInfo(st); return; }
      if (t.closest('summary')) return;
      const column = t.closest('.stage-column[data-stand-key]');
      const col = colOf(column?.dataset.standKey);
      if (!col) return;
      event.preventDefault();
      if (col.round != null) {
        const block = t.closest('.model-block');
        const model = block && S().rounds[col.round]?.models?.[Number(block.dataset.index)];
        stand.current = { step: col.step, where: model ? 'card' : 'stage' };
        if (model) cards().openModel?.(col.round, model.name);
        else cards().openRound?.(col.round);
        return;
      }
      if (col.synth) { openSynth(col); return; }
      openInfo(col.step);
    }, true);
    flow.addEventListener('change', (event) => {
      if (!stand.active) return;
      const select = event.target.closest('.synthesis-flow-select[data-stand-key]');
      if (!select) return;
      event.stopPropagation();
      const col = colOf(select.dataset.standKey);
      if (col?.synth) col.synth.model = select.value;
      render();
    }, true);
    // «Новый pipeline» и импорт состояния — только на исходном холсте.
    ['pipeline-add-btn', 'pipeline-import-btn'].forEach((id) => $(id)?.addEventListener('click', () => { if (stand.active) reset(); }, true));
    root.addEventListener('resize', () => { if (stand.active) draw(); });
    flow.addEventListener('toggle', () => { if (stand.active) draw(); }, true);
  }

  // ---------- Окно ввода ----------
  function standModal() {
    let modal = $('proto-stand-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal pipeline-block-info-modal custom-model-card custom-defaults-card';
    modal.id = 'proto-stand-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'proto-stand-title');
    modal.innerHTML = `<div class="modal-content">
      <header class="custom-card-top custom-defaults-top">
        <h3 class="custom-card-model" id="proto-stand-title">Стенд схемы<span class="custom-card-where">JSON { task, steps } · клавиша I</span></h3>
        <div class="proto-stand-actions">
          <button type="button" class="modal-button" id="proto-stand-example">Загрузить пример</button>
          <button type="button" class="modal-button" id="proto-stand-reset">Сбросить</button>
          <button type="button" class="modal-button accent" id="proto-stand-apply">Применить</button>
          <button type="button" class="modal-button" id="proto-stand-close">Закрыть</button>
        </div>
      </header>
      <div class="custom-card-body">
        <div class="custom-card-field">
          <div class="custom-card-head"><label for="proto-stand-json">Схема этапов</label><span>Вставьте JSON, который предложила нейросеть, и нажмите «Применить».</span></div>
          <textarea id="proto-stand-json" spellcheck="false" placeholder='{ "task": "…", "steps": [ … ] }'></textarea>
        </div>
        <div class="proto-stand-issues" id="proto-stand-issues"></div>
        <div class="custom-card-note"><button type="button" id="proto-stand-example-foreach">Пример с foreach</button></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const area = modal.querySelector('#proto-stand-json');
    modal.addEventListener('click', (event) => { if (event.target === modal) hide(modal); });
    modal.querySelector('#proto-stand-close').addEventListener('click', () => hide(modal));
    modal.querySelector('#proto-stand-example').addEventListener('click', () => { area.value = JSON.stringify(EXAMPLES.basic, null, 2); area.focus(); });
    modal.querySelector('#proto-stand-example-foreach').addEventListener('click', () => { area.value = JSON.stringify(EXAMPLES.foreach, null, 2); area.focus(); });
    modal.querySelector('#proto-stand-reset').addEventListener('click', () => { reset(); });
    modal.querySelector('#proto-stand-apply').addEventListener('click', () => {
      stand.text = area.value;
      const { schema, flat, issues } = validate(area.value);
      if (schema) applySchema(schema, flat, issues);
      drawIssues(schema ? null : 'Схема не применена.', issues);
      if (schema && !issues.length) hide(modal);
    });
    return modal;
  }
  function drawIssues(note, list = stand.issues) {
    const box = $('proto-stand-issues');
    if (!box) return;
    const errors = list.filter((it) => it.level === 'error').length;
    const head = note || (stand.active ? (list.length ? `Ошибок: ${errors}, замечаний: ${list.length - errors}. Схема нарисована.` : 'Замечаний нет. Схема нарисована.') : '');
    box.innerHTML = `${head ? `<div class="proto-stand-summary">${esc(head)}</div>` : ''}${list.map((it) => `<div class="is-${it.level}">${it.step ? `<b>${esc(it.step)}</b>: ` : ''}${esc(it.msg)}</div>`).join('')}`;
  }
  function openStand() {
    const modal = standModal();
    const area = modal.querySelector('#proto-stand-json');
    if (!area.value && stand.text) area.value = stand.text;
    drawIssues();
    show(modal);
    area.focus();
  }

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const info = $('proto-stand-info');
      if (info?.classList.contains('is-visible')) { hide(info); return; }
      const modal = $('proto-stand-modal');
      if (modal?.classList.contains('is-visible')) hide(modal);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (!['i', 'I', 'ш', 'Ш'].includes(event.key) && event.code !== 'KeyI') return;
    const t = event.target;
    if (t && (t.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || t.isContentEditable)) return;
    if (anyOpen() || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    openStand();
  });

  // Кнопка на странице: стенд открывается и без клавиши I.
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.id = 'proto-stand-open';
  openButton.textContent = 'Стенд JSON (I)';
  openButton.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:50;padding:8px 14px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;color:#334155;font:600 13px system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 6px rgba(15,23,42,.12)';
  openButton.addEventListener('click', () => { if (!anyOpen() && !document.querySelector('dialog[open]')) openStand(); });
  document.body.appendChild(openButton);

  // ---------- Стили стенда (только то, чего нет в настоящих стилях) ----------
  const style = document.createElement('style');
  style.textContent = `
    .model-block.proto-stand-card { height: auto; min-height: var(--pipeline-block-height); justify-content: flex-start; gap: 3px; cursor: pointer; }
    .proto-stand-icon { font-size: 14px; color: var(--pipeline-muted); flex: 0 0 auto; }
    .proto-stand-line { display: block; font-size: 10px; line-height: 1.35; color: var(--pipeline-muted); overflow-wrap: anywhere; }
    .proto-stand-repeat { color: #b45309; }
    .proto-stand-meta { width: 139px; margin-top: 6px; }
    .proto-stand-kind { background: #f1f5f9; color: #64748b; text-transform: uppercase; }
    .proto-stand-bang { flex: 0 0 auto; display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: #dc2626; color: #fff; font-size: 10px; font-weight: 700; cursor: help; }
    .proto-stand-bang.is-warn { background: #f59e0b; }
    .proto-stand-meta > .proto-stand-bang { float: right; }
    .proto-stand-body { font-size: 10px; color: var(--pipeline-text); }
    .proto-stand-body summary { cursor: pointer; color: var(--pipeline-muted); }
    .proto-stand-sub { display: flex; gap: 4px; align-items: center; padding: 2px 0; border-top: 1px dashed #e2e8f0; cursor: pointer; overflow-wrap: anywhere; }
    .proto-stand-actions { display: flex; gap: 8px; justify-self: end; flex-wrap: wrap; }
    .proto-stand-actions .modal-button { padding: 6px 14px; font-size: 13px; }
    #proto-stand-modal .custom-card-field textarea { font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.5; }
    .proto-stand-issues { max-height: 180px; overflow: auto; margin-top: 8px; font-size: 12px; line-height: 1.5; }
    .proto-stand-issues:empty { display: none; }
    .proto-stand-issues .is-error { color: #b91c1c; }
    .proto-stand-issues .is-warn { color: #b45309; }
    .proto-stand-summary { font-weight: 600; color: var(--pipeline-text); }
    .proto-stand-schema { grid-template-columns: 1fr; }
    #proto-stand-info .modal-content { height: auto; max-height: calc(100dvh - 32px); }
    .proto-stand-rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin-top: 6px; }
    .proto-stand-row { display: contents; }
    .proto-stand-row > span { color: var(--pipeline-muted); white-space: nowrap; }
    .proto-stand-row > div { color: var(--pipeline-text); white-space: pre-wrap; overflow-wrap: anywhere; }
  `;
  document.head.appendChild(style);

  // ---------- Примеры ----------
  const EXAMPLES = {
    basic: {
      task: 'Подготовить план запуска нового тарифа для малого бизнеса',
      steps: [
        { id: 's1', block: 'source', kind: 'text', title: 'Описание тарифа', artifacts: ['Бриф'], why: 'Даёт всем моделям одинаковые исходные данные о тарифе.' },
        { id: 's2', block: 'round', title: 'Первые планы', order: 'parallel', task: 'Предложи план запуска тарифа по брифу.', inputs: ['s1.Бриф'], artifacts: ['Черновики'],
          models: [{ name: 'Claude', role: 'автор', task: 'Сделай упор на сроки и этапы.' }, { name: 'GPT', role: 'критик', task: 'Ищи риски и слабые места.' }, { name: 'Gemini', role: 'аналитик', task: 'Оцени рынок и цены.' }],
          why: 'Три независимых взгляда на одну задачу.' },
        { id: 's3', block: 'synthesis', title: 'Сводный план', model: 'Claude', role: 'свести', task: 'Сведи черновики в один план.', inputs: ['s2.Черновики'], artifacts: ['План'], why: 'Нужен один план вместо трёх.' },
        { id: 's4', block: 'gate', title: 'Проверка плана', criteria: 'Есть сроки, бюджет и ответственные; нет противоречий.', inputs: ['s3.План'], artifacts: ['Вердикт'], why: 'Не отдавать план без сроков и бюджета.' },
        { id: 's5', block: 'round', title: 'Доработка', repeats: 's2', because: 'проверка s4 не пройдена', order: 'sequential', task: 'Исправь план по замечаниям проверки.', inputs: ['s3.План', 's4.Вердикт'], artifacts: ['Правки'],
          models: [{ name: 'Claude', role: 'автор' }, { name: 'GPT', role: 'критик' }, { name: 'Gemini', role: 'аналитик' }], why: 'Закрыть замечания проверки.' },
        { id: 's6', block: 'synthesis', title: 'Итоговый план', repeats: 's3', because: 'после доработки', model: 'GPT', role: 'судья', task: 'Собери итоговый план с учётом правок.', inputs: ['s5.Правки', 's3.План'], artifacts: ['Итог'], why: 'Окончательная версия плана.' },
        { id: 's7', block: 'file', title: 'Сохранить план', file: 'plan.md', mode: 'overwrite', inputs: ['s6.Итог'], why: 'Результат нужен файлом.' }
      ]
    },
    foreach: {
      task: 'Оценить каждую идею из списка и собрать рейтинг',
      steps: [
        { id: 's1', block: 'source', kind: 'document', title: 'Список идей', artifacts: ['Идеи'], why: 'Исходный материал — документ с идеями.' },
        { id: 's2', block: 'list', title: 'Разбить на пункты', from: 's1.Идеи', rule: 'одна идея — один пункт', artifacts: ['Пункты'], why: 'Каждую идею разбираем отдельно.' },
        { id: 's3', block: 'foreach', title: 'Разбор каждой идеи', over: 's2.Пункты', artifacts: ['Разборы'], why: 'Одинаковый разбор для всех пунктов.',
          body: [
            { id: 's3a', block: 'round', title: 'Разбор идеи', models: [{ name: 'Claude', role: 'аналитик' }, { name: 'GPT', role: 'критик' }], task: 'Разбери идею: плюсы, минусы, риски.', inputs: ['s3'], artifacts: ['Мнения'], why: 'Два взгляда на идею.' },
            { id: 's3b', block: 'synthesis', title: 'Вывод по идее', model: 'Gemini', role: 'сгруппировать', inputs: ['s3a.Мнения'], artifacts: ['Вывод'], why: 'Один вывод на идею.' }
          ] },
        { id: 's4', block: 'assemble', title: 'Собрать отчёт', inputs: ['s3.Разборы'], template: '# Идеи\n{для каждой: название, вывод}', artifacts: ['Отчёт'], why: 'Все разборы в одном документе.' },
        { id: 's5', block: 'score', title: 'Рейтинг', inputs: ['s4.Отчёт'], criteria: ['польза', 'стоимость', 'риск'], weights: { польза: 0.5, стоимость: 0.3, риск: 0.2 }, artifacts: ['Рейтинг'], why: 'Порядок, в котором браться за идеи.' }
      ]
    }
  };

  root.ProtoStand = {
    get active() { return stand.active; },
    version: STAND_VERSION, render, draw, validate, reset, open: openStand, examples: EXAMPLES
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindFlow);
  else bindFlow();
})(window);
