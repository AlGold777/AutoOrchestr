// Окна прототипа холста Basic: ▶, раунд, модель. Синтез — раунд из одной модели с ролью, своего окна нет.
// Разметка и классы — как в results.js (renderCustomBlockInspector) и results/stage-card.js;
// стили — только настоящие (styles.css проекта). Данные — window.ProtoState (CONTRACT.md).
(function initProtoCards(root) {
  'use strict';

  const base = (document.currentScript && document.currentScript.src) || root.location.href;
  const projectUrl = (path) => new URL(`../../../${path}`, base).href;

  // Тексты Basic: из disput/basic-schema.js, если он загружен, иначе их копия.
  const BASIC = {
    roundTask: 'Учти ответы предыдущего шага и дай свой улучшенный ответ на задачу.',
    discipline: {
      limit: '[RESPONSE_LIMIT] Объём ответа: {от}-{слов} слов, не больше.',
      content: 'Сосредоточься на ясной концепции и ключевых идеях; убери повторы, длинные пересказы и второстепенные детали.',
      delivery: 'Последней строкой ответа напиши только метку {метка}',
      correction: 'Твой предыдущий ответ {причина}. Дай ответ на задание полностью.'
    }
  };
  const basic = () => root.BasicSchema?.DEFAULTS || BASIC;

  // Роли (results.js, DEFAULT_JUDGE_SYSTEM_PROMPTS) и пункт Custom движка Basic.
  const ROLES = [
    { id: 'interaction_meta_synthesis', label: 'Synthes', text: 'Построй собственное экспертное решение, используя представленные версии как сырьё, а не как источник консенсуса. Возьми из них только идеи, которые усиливают твоё решение; слабые отбрось, даже если они встречаются во всех версиях. Проверяй заимствованное на фактическую точность. Результат — новый цельный ответ, а не пересказ и не компиляция.' },
    { id: 'interaction_critical_audit', label: 'Critique', text: 'Проведи экспертный аудит ответов и покажи то, что все пропустили:\n1. Слепые зоны — важные аспекты и следствия, которые никто не назвал.\n2. Ошибки — фактические неточности, логические противоречия, ложные причинно-следственные связи.\n3. Методология — неподходящие критерии и фреймворки, неучтённые ограничения и риски.\nКаждый пункт: конкретный пример → общий паттерн. Без вступлений, сразу к сути.' },
    { id: 'interaction_select_ideas', label: 'Select ideas', text: 'Извлеки из материала все уникальные идеи, включая слабые и спорные. Раздроби ответы до атомарных идей (одна идея = один пункт), объедини дубли, но сохрани отдельно варианты с разным подходом, акцентом или контекстом. Выдай нумерованный список, ранжированный по значимости. Начни сразу с пункта 1, без пояснений.' },
    { id: 'interaction_pattern_clustering', label: 'Clustering', text: 'Сгруппируй идеи по сути подхода, а не по формальным признакам. Для каждого кластера дай: концептуальное название (жирным), суть подхода одним предложением, список входящих идей. Идеи, не вписавшиеся ни в один кластер, вынеси отдельным блоком. Без преамбулы.' },
    { id: 'custom', label: 'Custom', text: '' }
  ];
  const ICONS = { Claude: 'claude', GPT: 'openai', Gemini: 'gemini', Grok: 'grok', 'Le Chat': 'le_chat', Qwen: 'qwen', DeepSeek: 'deepseek', Perplexity: 'perplexity', 'Z.ai': 'zai', Kimi: 'kimi' };
  const PLACEHOLDER = {
    previous: '‹ответы предыдущего шага появятся при запуске›',
    all: '‹все принятые ответы предыдущих шагов появятся при запуске›'
  };
  const DISCIPLINE_KEYS = ['limit', 'content', 'delivery', 'correction'];
  const DISCIPLINE_ROWS = [['limit', 'Длина'], ['content', 'Требования к содержанию'], ['delivery', 'Доставка'], ['correction', 'Повторный запрос']];

  const S = () => root.ProtoState || {};
  const own = (value) => typeof value === 'string' && Boolean(value.trim());
  const first = (...values) => values.find(own);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const roleId = (value) => (!value || value === 'None' ? '' : String(value));
  const roleState = (value) => value || 'None';
  const notify = () => { try { S().onChange?.(); } catch (error) { console.error(error); } };
  const general = () => Number(S().run?.maxWords) || 300;
  const lengthInstruction = (template, words) => String(template).replace(/\{от\}|\{слов\}/g, (key) => String(key === '{от}' ? Math.max(1, words - 50) : words));
  const flash = (button) => {
    button.classList.remove('btn-flash-success');
    void button.offsetWidth;
    button.classList.add('btn-flash-success');
    setTimeout(() => button.classList.remove('btn-flash-success'), 420);
  };
  const copyText = async (button, text) => {
    try { await navigator.clipboard.writeText(text); flash(button); } catch (_) { console.warn('Не удалось скопировать текст.'); }
  };

  // ---- Данные шага: раунд или синтез, с наследованием модель → раунд → ▶ → Basic ----
  const defaults = () => {
    const state = S();
    if (!state.defaults) state.defaults = {};
    const d = state.defaults;
    if (!d.discipline) d.discipline = { limit: '', content: '', delivery: '', correction: '', lines: [] };
    if (!d.modelNotes) d.modelNotes = {};
    if (!d.roundPrompts) d.roundPrompts = {};
    return d;
  };
  const roundInput = (round, index) => round.input || (index === 0 ? 'none' : 'previous');
  const roleText = (role, ref) => {
    const id = roleId(role);
    if (id === 'custom') return defaults().roundPrompts[ref] || '';
    return ROLES.find((item) => item.id === id)?.text || '';
  };
  // step: { kind, ref, label, input, task (round level), models: [{ name, ... }] }, target: the model's own settings.
  function stepFor(kind, index, name) {
    const state = S();
    const rounds = state.rounds || [];
    const round = kind === 'round' ? rounds[index] : null;
    if (!round) return null;
    const target = (round.models || []).find((model) => model.name === name);
    if (!target) return null;
    return { kind, index, ref: round.ref || `r${index + 1}`, label: `Раунд ${index + 1}`, input: roundInput(round, index),
      roundTask: round.task, target, name };
  }
  const taskFallback = () => first(defaults().roundTask) || basic().roundTask;
  const inheritedTask = (step) => first(step.roundTask) || taskFallback(step);
  const inheritedDiscipline = (key) => first(defaults().discipline[key]) || basic().discipline[key];
  const wordsOf = (target) => (Number.isSafeInteger(Number(target.maxWords)) && Number(target.maxWords) > 0 ? Number(target.maxWords) : general());

  // Автоматический запрос (часть, которую можно заменить своим): как CustomEngine.previewPrompt().template.
  function automaticRequest(step, { role = step.target.role, task = first(step.target.task) || inheritedTask(step) } = {}) {
    const parts = ['Задача:\n{задача}'];
    const hasEarlierStep = step.index > 0;
    if (step.input !== 'none' && hasEarlierStep) {
      parts.push(step.input === 'all' ? 'Принятые ответы всех предыдущих шагов:\n\nВход:\n{вход}' : 'Ответы предыдущего шага:\n\nОтвет 1:\n{вход}');
    }
    if (step.input !== 'none' && own(task)) parts.push(`Задание:\n${task.trim()}`);
    const extra = roleText(role, step.ref);
    if (own(extra)) parts.push(`Дополнительно для тебя:\n${extra.trim()}`);
    return parts.join('\n\n');
  }
  const baseRequest = (step, options) => automaticRequest(step, options);

  // Полный запрос в порядке basic-windows.md: запрос (с ролью) → ответы владельца → особенность модели →
  // лимит → требования к содержанию (и свои строки) → метка доставки.
  function previewPrompt(kind, index, name) {
    const step = stepFor(kind, index, name);
    if (!step) return '';
    const target = step.target;
    const value = (key) => first(target.discipline?.[key]) || inheritedDiscipline(key);
    const lines = [...(defaults().discipline.lines || []), ...(target.discipline?.lines || [])].filter(own);
    return [
      own(target.request) ? target.request : baseRequest(step),
      defaults().modelNotes[step.name],
      lengthInstruction(value('limit'), wordsOf(target)),
      value('content'),
      ...lines,
      value('delivery').replace(/\{метка\}/g, '[[END_…]]')
    ].filter(own).join('\n\n');
  }

  // ---- Модальное окно карточки (как #pipeline-block-info-modal) ----
  let onKey = null;
  function cardModal() {
    let modal = document.getElementById('pipeline-block-info-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal pipeline-block-info-modal';
      modal.id = 'pipeline-block-info-modal';
      modal.setAttribute('aria-hidden', 'true');
      modal.innerHTML = '<div class="modal-content"></div>';
      document.body.appendChild(modal);
      modal.addEventListener('click', (event) => { if (event.target === modal) closeCard(); });
    }
    return modal;
  }
  function showCard(modal) {
    modal.style.display = 'flex';
    modal.classList.add('is-visible');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
    if (!onKey) {
      onKey = (event) => { if (event.key === 'Escape') closeCard(); };
      document.addEventListener('keydown', onKey);
    }
    (modal.querySelector('#custom-card-request') || modal.querySelector('textarea'))?.focus();
  }
  function closeCard() {
    const modal = document.getElementById('pipeline-block-info-modal');
    if (modal) { modal.style.display = 'none'; modal.classList.remove('is-visible'); modal.setAttribute('aria-hidden', 'true'); }
    document.body.classList.remove('modal-open');
    if (onKey) { document.removeEventListener('keydown', onKey); onKey = null; }
  }

  const copyButton = (id, label) => `<button type="button" data-action="copy" data-copy-field="${id}" title="Копировать" aria-label="Копировать: ${esc(label)}"><i class="ti ti-copy" aria-hidden="true"></i></button>`;
  const roleOptions = (value) => [{ id: '', label: 'None' }, ...ROLES].map((item) => `<option value="${item.id}"${item.id === value ? ' selected' : ''}>${esc(item.label)}</option>`).join('');

  // One renderer for ▶ (entry) and a round model's card, after renderCustomBlockInspector.
  function renderCard(spec) {
    const entry = Boolean(spec.entry);
    const step = entry ? null : stepFor(spec.kind, spec.index, spec.name);
    if (!entry && !step) { console.warn('ProtoCards: шаг или модель не найдены', spec); return; }
    const d = defaults();
    const target = entry ? d : step.target;
    if (!entry && !target.discipline) target.discipline = {};
    const words = general();
    const rows = entry
      ? [['roundTask', 'Задание раундов со входом (R2+)'], ...DISCIPLINE_ROWS]
      : [...(step.input !== 'none' ? [['task', 'Задание раунда']] : []), ...DISCIPLINE_ROWS];
    const isTask = (key) => ['task', 'roundTask'].includes(key);
    const fallbackFor = (key) => (key === 'roundTask' ? basic().roundTask : basic().discipline[key]);
    const inheritedValue = (key) => (entry ? fallbackFor(key) : key === 'task' ? inheritedTask(step) : inheritedDiscipline(key));
    const rawValue = (key) => (isTask(key) ? target[key] : target.discipline?.[key]);
    const effectiveValue = (key) => first(rawValue(key)) || inheritedValue(key);
    const modelNotes = d.modelNotes;
    const canvasModels = entry ? [...new Set((S().rounds || []).flatMap((round) => (round.models || []).map((model) => model.name)))] : [];
    let role = entry ? '' : roleId(target.role);
    let baseTemplate = entry ? '' : baseRequest(step, { role });
    const name = entry ? '' : step.name;
    const icon = ICONS[name] ? `<img src="${projectUrl(`icons/models/${ICONS[name]}.svg`)}" alt="" width="26" height="26">` : '';

    const modal = cardModal();
    const content = modal.querySelector('.modal-content');
    modal.classList.add('custom-model-card');
    modal.classList.toggle('custom-defaults-card', entry);
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'pipeline-block-info-title');
    content.innerHTML = `
      <header class="custom-card-top ${entry ? 'custom-defaults-top' : ''}">
        <h3 class="custom-card-model" id="pipeline-block-info-title">${entry ? '▶ Basic' : `${icon}${esc(name)}<span class="custom-card-where">${esc(step.label)}</span>`}</h3>
        ${entry ? '' : `<div class="custom-card-length"><label for="custom-card-length">Длина ответа:</label> <input id="custom-card-length" type="number" min="1" step="1" inputmode="numeric" placeholder="${words}" aria-describedby="custom-card-length-note"> слов</div>`}
        <button type="button" class="modal-button accent" id="custom-card-save">Save</button>
      </header>
      <div class="custom-card-body">
        ${entry ? '<p class="custom-card-note">Общие значения для всех шагов. Своё значение модели имеет приоритет; пустое поле наследует значение из кода.</p>' : `
        <label class="custom-card-head">Роль <select class="stage-card-role-select" id="custom-card-role">${roleOptions(role)}</select></label>
        <div class="custom-card-field">
          <div class="custom-card-head"><label for="custom-card-request">Запрос</label><span><code>{задача}</code> и <code>{вход}</code> подставляются при запуске. Изменённый текст используется только для этой модели в этом шаге.</span><span class="custom-card-actions">${copyButton('custom-card-request', 'Запрос')}</span></div>
          <textarea id="custom-card-request" spellcheck="false"></textarea>
          <div class="custom-card-note"><span id="custom-card-personal-note"></span> <button type="button" id="custom-card-reset">Вернуть автоматическую сборку</button></div>
        </div>`}
        ${!entry && own(modelNotes[name]) ? `<p class="custom-card-note">Особенность модели (из ▶): ${esc(modelNotes[name])}</p>` : ''}
        ${!entry ? '<p class="custom-card-note" id="custom-card-role-note" hidden>Роль не применяется: используется персональный запрос.</p>' : ''}
        <div class="custom-card-marks"><strong>${entry ? 'Общие задания и дисциплина' : 'Метки транспорта'}</strong>
          ${rows.map(([key, label]) => `<div class="custom-card-discipline" data-discipline="${key}">
            <div class="custom-card-discipline-head"><label for="custom-discipline-${key}">${label}</label>
              <div class="custom-card-actions">
                ${copyButton(`custom-discipline-${key}`, label)}
                <button type="button" data-action="inherit" title="${entry ? 'Вернуть к коду' : 'Вернуть к общему'}" aria-label="Вернуть к общему: ${label}" hidden>↶</button>
                <button type="button" data-action="clear" title="Очистить — наследовать" aria-label="Очистить: ${label}" class="custom-card-clear">×</button>
                <button type="button" data-action="save" title="Сохранить" aria-label="Сохранить: ${label}" class="custom-card-commit">✓</button>
              </div>
            </div>
            <textarea id="custom-discipline-${key}" rows="2" spellcheck="false"></textarea>
          </div>`).join('')}
          <div class="custom-card-lines"></div>
          <div class="custom-card-actions"><button type="button" id="custom-card-line-add" aria-label="Добавить строку" title="Добавить строку">+</button></div>
          <div class="custom-card-note">{от} — на 50 слов меньше предела; {слов} — предел из шапки pipeline; {метка} — новая метка; {причина} — причина повтора. Пустое поле наследуется. При повторе запрос заменяется инструкцией исправления.</div>
        </div>
        ${entry ? `<div class="custom-card-marks"><strong>Особенности моделей</strong>
          ${canvasModels.map((item) => `<div class="custom-card-discipline">
            <div class="custom-card-discipline-head"><span>${esc(item)}</span></div>
            <textarea data-model-note="${esc(item)}" aria-label="Особенность: ${esc(item)}" rows="2" spellcheck="false">${esc(modelNotes[item] || '')}</textarea>
          </div>`).join('') || '<div class="custom-card-note">На холсте нет моделей.</div>'}
          <div class="custom-card-note">Добавляется к каждому запросу модели после запроса и ответов владельца, перед лимитом. Пустое поле — ничего не добавлять.</div>
        </div>` : ''}
        ${entry ? '' : `<span id="custom-card-length-note" class="custom-card-sr-only">Пусто — общий предел pipeline (${words}).</span>`}
      </div>`;

    const request = content.querySelector('#custom-card-request');
    const length = content.querySelector('#custom-card-length');
    const reset = content.querySelector('#custom-card-reset');
    const save = content.querySelector('#custom-card-save');
    const roleSelect = content.querySelector('#custom-card-role');
    if (request) request.value = own(target.request) ? target.request : baseTemplate;
    if (length) length.value = Number(target.maxWords) > 0 ? target.maxWords : words;
    const dirty = new Set();
    const fields = {};
    const lineValues = [...(target.discipline?.lines || [])];
    const display = (key, value) => (key === 'limit' ? lengthInstruction(value, Number(length?.value || words)) : value);
    let lengthDirty = false;
    const refresh = () => {
      if (request) {
        const personal = request.value !== baseTemplate;
        reset.hidden = !personal;
        content.querySelector('#custom-card-personal-note').textContent = personal ? 'Персональный запрос: общее задание не применяется; дисциплина применяется.' : '';
        const roleNote = content.querySelector('#custom-card-role-note');
        if (roleNote) roleNote.hidden = !(personal && role);
      }
      rows.forEach(([key]) => {
        if (!dirty.has(key)) fields[key].value = display(key, effectiveValue(key));
        fields[key].placeholder = display(key, inheritedValue(key));
        const mine = dirty.has(key) ? own(fields[key].value) : own(rawValue(key));
        content.querySelector(`[data-discipline="${key}"] [data-action="inherit"]`).hidden = !mine;
      });
    };

    const saveSettings = (close) => {
      if (request && !request.value.trim()) { request.focus(); console.warn('Введите запрос.'); return false; }
      if (length && (!length.checkValidity() || (length.value !== '' && !Number.isSafeInteger(Number(length.value))))) { length.reportValidity(); return false; }
      const values = {};
      rows.forEach(([key]) => {
        let value = dirty.has(key) ? fields[key].value : (rawValue(key) || '');
        // The shown length instruction has the numbers filled in; typed unchanged it stands for its template.
        if (dirty.has(key) && key === 'limit' && value === display(key, inheritedValue(key))) value = inheritedValue(key);
        values[key] = own(value) ? value : '';
      });
      const discipline = { ...(target.discipline || {}) };
      DISCIPLINE_KEYS.forEach((key) => { if (key in values) discipline[key] = values[key]; });
      discipline.lines = lineValues.map((line) => line.trim()).filter(Boolean);
      target.discipline = discipline;
      if (entry) {
        target.roundTask = values.roundTask;
        // Notes of models that are off the canvas stay saved.
        content.querySelectorAll('[data-model-note]').forEach((field) => {
          const value = field.value.trim();
          if (value) modelNotes[field.dataset.modelNote] = value;
          else delete modelNotes[field.dataset.modelNote];
        });
      } else {
        if ('task' in values) target.task = values.task;
        // A request equal to the automatic one stays inherited; an untouched length stays as it was.
        target.request = request.value === baseTemplate ? '' : request.value;
        if (lengthDirty) target.maxWords = length.value === '' ? '' : Number(length.value);
        if (roleSelect) target.role = roleState(role);
      }
      notify();
      if (close) closeCard();
      else { renderCard(spec); modal.querySelector('textarea')?.focus(); }
      return true;
    };

    rows.forEach(([key]) => {
      const row = content.querySelector(`[data-discipline="${key}"]`);
      const field = row.querySelector('textarea');
      fields[key] = field;
      field.addEventListener('input', () => { dirty.add(key); refresh(); });
      row.querySelectorAll('button:not([data-action="copy"])').forEach((button) => button.addEventListener('click', () => {
        if (button.dataset.action === 'save') { if (dirty.has(key)) saveSettings(false); return; }
        field.value = '';
        dirty.add(key);
        refresh();
        if (button.dataset.action === 'inherit') saveSettings(false);
        else field.focus();
      }));
    });
    content.querySelectorAll('[data-copy-field]').forEach((button) => button.addEventListener('click', () => {
      const field = content.querySelector(`#${button.dataset.copyField}`);
      if (field) copyText(button, field.value);
    }));
    request?.addEventListener('input', refresh);
    length?.addEventListener('input', () => { lengthDirty = true; refresh(); });
    reset?.addEventListener('click', () => { request.value = baseTemplate; refresh(); });
    // The role changes the automatic request; a request the owner did not replace follows it.
    roleSelect?.addEventListener('change', () => {
      const automatic = request.value === baseTemplate;
      role = roleSelect.value;
      baseTemplate = baseRequest(step, { role });
      if (automatic) request.value = baseTemplate;
      refresh();
    });

    const drawLines = () => {
      const box = content.querySelector('.custom-card-lines');
      if (!box) return;
      box.innerHTML = lineValues.map((value, index) => `<div class="custom-card-discipline" data-line="${index}">
        <div class="custom-card-discipline-head"><label for="custom-line-${index}">Строка ${index + 1}</label>
          <div class="custom-card-actions">
            ${copyButton(`custom-line-${index}`, `Строка ${index + 1}`)}
            <button type="button" data-action="remove" title="Удалить строку" aria-label="Удалить: Строка ${index + 1}" class="custom-card-clear">×</button>
            <button type="button" data-action="save" title="Сохранить" aria-label="Сохранить: Строка ${index + 1}" class="custom-card-commit">✓</button>
          </div>
        </div>
        <textarea id="custom-line-${index}" rows="2" spellcheck="false">${esc(value)}</textarea>
      </div>`).join('');
      box.querySelectorAll('[data-line]').forEach((row) => {
        const index = Number(row.dataset.line);
        const field = row.querySelector('textarea');
        field.addEventListener('input', () => { lineValues[index] = field.value; });
        row.querySelector('[data-action="copy"]').addEventListener('click', (event) => copyText(event.currentTarget, field.value));
        row.querySelector('[data-action="remove"]').addEventListener('click', () => { lineValues.splice(index, 1); drawLines(); });
        row.querySelector('[data-action="save"]').addEventListener('click', () => saveSettings(false));
      });
    };
    content.querySelector('#custom-card-line-add')?.addEventListener('click', () => {
      lineValues.push('');
      drawLines();
      content.querySelector(`#custom-line-${lineValues.length - 1}`)?.focus();
    });
    drawLines();
    save.addEventListener('click', () => saveSettings(true));
    refresh();
    showCard(modal);
  }

  // ---- Окно раунда: настоящая results/stage-card.js в <dialog class="pipeline-stage-dialog"> ----
  let stageCardReady = null;
  const loadStageCard = () => {
    if (root.StageCard) return Promise.resolve(root.StageCard);
    if (!stageCardReady) {
      stageCardReady = new Promise((resolve) => {
        const script = document.createElement('script');
        script.src = projectUrl('results/stage-card.js');
        script.onload = () => resolve(root.StageCard || null);
        script.onerror = () => { console.error('ProtoCards: не загружен results/stage-card.js'); resolve(null); };
        document.head.appendChild(script);
      });
    }
    return stageCardReady;
  };
  function stageDialog() {
    let dialog = document.getElementById('pipeline-stage-dialog');
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'pipeline-stage-dialog';
      dialog.id = 'pipeline-stage-dialog';
      dialog.setAttribute('aria-labelledby', 'pipeline-stage-dialog-title');
      dialog.innerHTML = '<header class="pipeline-stage-dialog-header"><h2 id="pipeline-stage-dialog-title"></h2><button type="button" data-stage-close aria-label="Закрыть">×</button></header><div class="pipeline-stage-card" id="pipeline-stage-card"></div>';
      document.body.appendChild(dialog);
      dialog.addEventListener('click', (event) => {
        if (event.target.closest?.('[data-stage-close]')) { dialog.close(); return; }
        if (event.target !== dialog) return;
        const rect = dialog.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
      });
    }
    return dialog;
  }
  async function openRound(index) {
    const round = S().rounds?.[index];
    if (!round) { console.warn('ProtoCards: нет раунда', index); return; }
    const StageCard = await loadStageCard();
    const dialog = stageDialog();
    const title = dialog.querySelector('#pipeline-stage-dialog-title');
    const body = dialog.querySelector('#pipeline-stage-card');
    const ref = round.ref || `r${index + 1}`;
    if (!StageCard) { title.textContent = `Этап ${index + 1}`; body.replaceChildren(); if (!dialog.open) dialog.showModal(); return; }
    const models = round.models || [];
    const model = StageCard.buildModel({
      round: index + 1,
      participants: models.map((item) => ({ name: item.name, send: item.enabled !== false })),
      roleChoice: {
        prompts: ROLES.map(({ id, label }) => ({ id, label })),
        roles: models.map((item) => roleId(item.role)),
        disabled: false,
        roundPrompt: defaults().roundPrompts[ref] || '',
        settings: { input: round.input || '', task: round.task || '' },
        first: index === 0,
        inheritedTask: first(defaults().roundTask) || basic().roundTask
      }
    });
    title.textContent = model.title;
    StageCard.render(body, model, {
      onRole: async (select) => {
        const value = select.value;
        if (new Set(models.map((item) => roleId(item.role))).size > 1 && !root.confirm('Заменить роли моделей раунда?')) { select.value = 'mixed'; return; }
        round.role = roleState(value);
        models.forEach((item) => { item.role = roleState(value); });
        notify();
      },
      onRoundPrompt: (text) => {
        if (own(text)) defaults().roundPrompts[ref] = text;
        else delete defaults().roundPrompts[ref];
        notify();
      },
      onSetting: (field, value) => {
        round[field] = value;
        notify();
        openRound(index);
      }
    });
    if (!dialog.open) dialog.showModal();
  }

  const openEntry = () => renderCard({ entry: true });
  const openModel = (index, name) => renderCard({ kind: 'round', index, name });
  root.ProtoCards = { openEntry, openRound, openModel, previewPrompt, close: closeCard };
  loadStageCard();
})(window);
