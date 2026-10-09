// Stage card: the dialog that opens on a round badge of the pipeline canvas.
// buildModel is pure (unit-tested); render writes it with textContent only.
(function initStageCard(root) {
  'use strict';

  const STATUS = {
    gate: 'Ворота: решает модератор',
    pending: 'Ожидает',
    running: 'Выполняется',
    awaiting_participant: 'Ждёт участника',
    completed: 'Выполнен',
    failed: 'Ошибка',
    cancelled: 'Отменён'
  };
  const PURPOSE = {
    position: 'позиция', response: 'ответ', critique: 'критика', verification: 'проверка',
    evidence_review: 'разбор доказательств', synthesis: 'синтез', audit: 'аудит', human_judgment: 'решение модератора'
  };
  const WHO = {
    all: 'все модели независимо', lead: 'ведущая модель', review: 'проверяющая модель', gate: 'моделей нет — ворота'
  };
  const list = (value) => (Array.isArray(value) ? value.filter(Boolean).map(String) : []);

  // round: canvas round number; templateStage: ArchitectureFramework stage or null;
  // participants: [{ name, send }] from the round's model stack; stageRun: the engine's
  // stage instance for this round (or null before / outside a run).
  // roleChoice (Custom rounds only): { prompts: [{ id, label }], roles: [prompt id or ''] per block,
  // disabled, roundPrompt } — one select for the whole round; mixed roles show 'разные' until chosen.
  // The round's text field shows only while 'custom' is selected.
  // roleChoice.settings (the round card of Basic): { order, input, task } the owner set ('' = not set, inherited),
  // inheritedTask (the text the round would take), first (the first round: nothing to feed in), disabled.
  // They give the order of work, the input and the round's task.
  function buildModel({ round, templateStage = null, participants = [], stageRun = null, roleChoice = null } = {}) {
    const working = list(participants.filter((item) => item && item.send).map((item) => item.name));
    const waiting = list(participants.filter((item) => item && !item.send).map((item) => item.name));
    const gate = templateStage?.who === 'gate';
    const statusCode = gate && !stageRun ? 'gate' : String(stageRun?.status || 'pending');
    const model = {
      round: Number(round) || 0,
      title: templateStage ? `Этап ${templateStage.n} · ${templateStage.titleRu}` : `Этап ${round}`,
      subtitle: templateStage ? `${templateStage.phaseRu} · ${templateStage.title}` : '',
      badges: [],
      status: { code: statusCode, label: STATUS[statusCode] || statusCode },
      participants: { working, waiting },
      sections: [],
      instruction: templateStage?.instruction || ''
    };
    if (!templateStage) {
      if (roleChoice) {
        const roles = (Array.isArray(roleChoice.roles) ? roleChoice.roles : []).map((item) => String(item || ''));
        const distinct = [...new Set(roles)];
        const mixed = distinct.length > 1;
        model.role = {
          value: mixed ? 'mixed' : (distinct[0] || ''),
          disabled: Boolean(roleChoice.disabled),
          text: String(roleChoice.roundPrompt || ''),
          options: [
            ...(mixed ? [{ value: 'mixed', label: 'разные', disabled: true }] : []),
            { value: '', label: 'None' },
            ...(Array.isArray(roleChoice.prompts) ? roleChoice.prompts : []).map((prompt) => ({ value: String(prompt.id), label: String(prompt.label || prompt.id) }))
          ]
        };
        if (roleChoice.settings) model.settings = settingsModel(roleChoice.settings, roleChoice);
        return model;
      }
      model.sections.push({ title: 'Участники раунда', items: working.length ? working : ['никто не отправляет'] });
      return model;
    }
    model.badges.push(PURPOSE[templateStage.purpose] || templateStage.purpose);
    model.badges.push(WHO[templateStage.who] || templateStage.who);
    if (templateStage.independent) model.badges.push('независимый');
    if (templateStage.gate) model.badges.push(`ворота ${templateStage.gate}`);
    list(templateStage.roles).forEach((role) => model.badges.push(role));
    [
      ['Входы', templateStage.inputs],
      ['Что нужно сделать', templateStage.allowed],
      ['Чего делать нельзя', templateStage.forbidden],
      ['Правила', templateStage.rules]
    ].forEach(([title, items]) => {
      if (list(items).length) model.sections.push({ title, items: list(items) });
    });
    const result = [
      list(templateStage.creates).length ? `создаёт: ${list(templateStage.creates).join(', ')}` : '',
      list(templateStage.modifies).length ? `изменяет: ${list(templateStage.modifies).join(', ')}` : ''
    ].filter(Boolean);
    if (result.length) model.sections.push({ title: 'Результат (объекты схемы)', items: result });
    return model;
  }

  const ORDER_LABELS = { parallel: 'Параллельно', sequential: 'По очереди' };
  const INPUT_LABELS = { none: 'Ничего', previous: 'Ответы предыдущего шага', all: 'Всё принятое за все предыдущие шаги' };
  // The default of the input depends on the place: the first round has none, a later round takes the previous step.
  function settingsModel(settings, { first = false, inheritedTask = '', disabled = false } = {}) {
    const order = String(settings.order || '');
    const input = String(settings.input || '');
    const defaultInput = first ? 'none' : 'previous';
    const effectiveInput = input || defaultInput;
    return {
      disabled: Boolean(disabled),
      order: { value: order, options: [{ value: '', label: `По умолчанию (${ORDER_LABELS.parallel.toLowerCase()})` }, ...Object.entries(ORDER_LABELS).map(([value, label]) => ({ value, label }))] },
      // The first round has no earlier step: its input is not offered.
      input: first ? null : { value: input, options: [{ value: '', label: `По умолчанию (${INPUT_LABELS[defaultInput].toLowerCase()})` }, ...Object.entries(INPUT_LABELS).map(([value, label]) => ({ value, label }))] },
      // The task is sent only with an input; with none it is not used.
      task: effectiveInput === 'none' ? null : { value: String(settings.task || ''), placeholder: String(inheritedTask || '') }
    };
  }

  const el = (documentRef, tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function render(container, model, { onCopy = null, onRole = null, onRoundPrompt = null, onSetting = null } = {}) {
    const doc = container.ownerDocument;
    container.replaceChildren();
    if (model.subtitle) container.append(el(doc, 'p', 'stage-card-subtitle', model.subtitle));
    const meta = el(doc, 'div', 'stage-card-badges');
    model.badges.forEach((badge) => meta.append(el(doc, 'span', 'stage-card-badge', badge)));
    meta.append(el(doc, 'span', `stage-card-badge stage-card-status stage-card-status-${model.status.code}`, model.status.label));
    container.append(meta);

    if (model.role) {
      const select = el(doc, 'select', 'stage-card-role-select');
      model.role.options.forEach((item) => {
        const option = el(doc, 'option', '', item.label);
        option.value = item.value;
        option.disabled = Boolean(item.disabled);
        select.append(option);
      });
      select.value = model.role.value;
      select.disabled = model.role.disabled;
      const area = el(doc, 'textarea', 'stage-card-role-prompt');
      area.value = model.role.text;
      area.rows = 3;
      area.spellcheck = false;
      area.disabled = model.role.disabled;
      area.hidden = model.role.value !== 'custom';
      area.setAttribute('aria-label', 'Текст Custom для всех моделей раунда');
      area.addEventListener('change', () => { if (typeof onRoundPrompt === 'function') onRoundPrompt(area.value); });
      // The text field follows the choice; a replacement the owner cancels hides it again.
      select.addEventListener('change', async () => {
        area.hidden = select.value !== 'custom';
        if (typeof onRole === 'function') await onRole(select);
        area.hidden = select.value !== 'custom';
      });
      const row = el(doc, 'label', 'stage-card-role');
      row.append(doc.createTextNode('Роль для всех моделей раунда '), select);
      container.append(row, area);
      if (model.settings) {
        const settings = model.settings;
        const emit = (field, value) => { if (typeof onSetting === 'function') onSetting(field, value); };
        const choice = (field, label, data) => {
          const select = el(doc, 'select', `stage-card-${field}-select`);
          data.options.forEach((item) => { const option = el(doc, 'option', '', item.label); option.value = item.value; select.append(option); });
          select.value = data.value;
          select.disabled = settings.disabled;
          select.addEventListener('change', () => emit(field, select.value));
          const wrap = el(doc, 'label', `stage-card-setting stage-card-${field}`);
          wrap.append(doc.createTextNode(`${label} `), select);
          container.append(wrap);
        };
        choice('order', 'Порядок работы', settings.order);
        if (settings.input) choice('input', 'Вход раунда', settings.input);
        if (settings.task) {
          const area = el(doc, 'textarea', 'stage-card-task');
          area.value = settings.task.value;
          area.placeholder = settings.task.placeholder;
          area.rows = 3;
          area.spellcheck = false;
          area.disabled = settings.disabled;
          area.setAttribute('aria-label', 'Задание раунда');
          area.addEventListener('change', () => emit('task', area.value));
          const wrap = el(doc, 'label', 'stage-card-setting stage-card-task-label');
          wrap.append(doc.createTextNode('Задание раунда (пусто — общее) '), area);
          container.append(wrap);
        }
      }
    } else {
      const people = el(doc, 'div', 'stage-card-people');
      if (model.participants.working.length) {
        people.append(el(doc, 'strong', '', 'Работают: '), doc.createTextNode(model.participants.working.join(', ')));
      } else {
        people.append(el(doc, 'strong', '', 'Работают: '), doc.createTextNode('никто'));
      }
      if (model.participants.waiting.length) {
        people.append(doc.createElement('br'), el(doc, 'span', 'stage-card-muted', `Не участвуют: ${model.participants.waiting.join(', ')}`));
      }
      container.append(people);
    }

    model.sections.forEach((section) => {
      const block = el(doc, 'section', 'stage-card-section');
      block.append(el(doc, 'h3', '', section.title));
      const ul = el(doc, 'ul');
      section.items.forEach((item) => ul.append(el(doc, 'li', '', item)));
      block.append(ul);
      container.append(block);
    });

    if (model.instruction) {
      const block = el(doc, 'section', 'stage-card-section');
      const head = el(doc, 'h3', '', 'Задание, которое получает модель');
      block.append(head, el(doc, 'pre', 'stage-card-instruction', model.instruction));
      if (typeof onCopy === 'function') {
        const copy = el(doc, 'button', 'stage-card-copy', 'Копировать задание');
        copy.type = 'button';
        copy.addEventListener('click', () => onCopy(model.instruction));
        block.append(copy);
      }
      container.append(block);
    }
  }

  const api = Object.freeze({ buildModel, render, STATUS });
  root.StageCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
