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
        if (roleChoice.settings) {
          model.settings = settingsModel(roleChoice.settings, { ...roleChoice, enabledCount: working.length });
          if (model.settings.owner.checked) model.badges.push('владелец: одобрение');
        }
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
  const STEPS_LABEL = 'Выбранные этапы';
  const REQUIRE_LABELS = { any: 'Любой ответ', all: 'Все включённые', count: 'Число' };
  const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  // The input «выбранные этапы» (4.3): the owner's list of step refs keeps its order; entries that are not step refs
  // (a participant, an artifact written in JSON) stay in place. Returns the new list for the step ref.
  function stepsAfterToggle(current, ref, checked) {
    const list = Array.isArray(current) ? current.slice() : [];
    const at = list.indexOf(ref);
    if (checked && at < 0) list.push(ref);
    if (!checked && at >= 0) list.splice(at, 1);
    return list;
  }

  // The owner's edit of the output: name, form, sections (non-empty lines) and strictLength replace their values;
  // the other fields (format, requiredFields, artifacts, revisionOf) stay as they are. A json format has no sections.
  function outputAfterEdit(current = {}, edited = {}) {
    const next = { ...(isPlain(current) ? current : {}) };
    ['name', 'form', 'sections', 'strictLength'].forEach((key) => delete next[key]);
    if (String(edited.name || '').trim()) next.name = String(edited.name);
    if (String(edited.form || '').trim()) next.form = String(edited.form);
    const sections = list(edited.sections).map((line) => line.trim()).filter(Boolean);
    if (sections.length && next.format !== 'json') next.sections = sections;
    if (edited.strictLength === true) next.strictLength = true;
    return next;
  }

  // The fields of a step the card shows: input, require, owner, output. A draft is a choice the owner made in the card
  // that the schema does not hold yet («выбранные этапы» without a step, the number of required answers).
  function stepRestModel(settings = {}, { enabledCount = 0, drafts = {} } = {}) {
    const req = settings.require;
    const requireValue = typeof req === 'number' ? 'count' : (req === 'any' || req === 'all' ? req : (drafts.require === 'count' ? 'count' : ''));
    const output = isPlain(settings.output) ? settings.output : {};
    return {
      require: {
        value: requireValue,
        count: typeof req === 'number' ? req : '',
        max: Number(enabledCount) || 0,
        options: [
          { value: '', label: 'По умолчанию (любой ответ)' },
          { value: 'any', label: REQUIRE_LABELS.any },
          { value: 'all', label: REQUIRE_LABELS.all },
          { value: 'count', label: REQUIRE_LABELS.count }
        ]
      },
      owner: { checked: settings.owner === 'approve' },
      output: {
        name: String(output.name || ''),
        form: String(output.form || ''),
        sections: Array.isArray(output.sections) ? output.sections.map(String).join('\n') : '',
        strictLength: output.strictLength === true,
        json: output.format === 'json'
      }
    };
  }

  // The input of a step: `first` (the first round has nothing to feed in) gives null. An array of refs or a drafted
  // «steps» shows the choice «выбранные этапы» with the earlier steps; `kind` decides the other options.
  function stepInputModel(settings = {}, { kind = 'round', first = false, earlier = [], drafts = {} } = {}) {
    if (first && kind === 'round') return null;
    const input = Array.isArray(settings.input) ? settings.input : String(settings.input || '');
    const picked = Array.isArray(input) ? input : [];
    const defaultInput = kind === 'round' && first ? 'none' : 'previous';
    const stepsMode = Array.isArray(input) || input === 'steps' || drafts.input === 'steps';
    const refs = picked.filter((item) => typeof item === 'string');
    const options = [
      { value: '', label: `По умолчанию (${INPUT_LABELS[defaultInput].toLowerCase()})` },
      ...(kind === 'round' ? Object.entries(INPUT_LABELS).map(([value, label]) => ({ value, label })) : [{ value: 'previous', label: INPUT_LABELS.previous }]),
      { value: 'steps', label: STEPS_LABEL }
    ];
    return {
      value: stepsMode ? 'steps' : input,
      options,
      steps: earlier.map((item) => {
        const at = refs.indexOf(item.ref);
        return { ref: item.ref, label: item.label, disabled: !item.enabled, checked: at >= 0, number: at >= 0 ? at + 1 : 0 };
      }),
      objectRefs: picked.length - refs.length
    };
  }

  // The fields of a synthesis (its window): input, require, owner, output. Settings are the step's own fields.
  function stepFieldsModel({ kind = 'round', settings = {}, earlier = [], enabledCount = 0, drafts = {}, disabled = false } = {}) {
    return {
      disabled: Boolean(disabled),
      input: stepInputModel(settings, { kind, earlier, drafts }),
      ...stepRestModel(settings, { enabledCount, drafts })
    };
  }

  // The order, the input and the task of a round card; `first` and `inheritedTask` as before. The input of a later round
  // is the previous step by default, the first round has no input (null).
  function settingsModel(settings, { first = false, inheritedTask = '', disabled = false, earlier = [], enabledCount = 0, drafts = {} } = {}) {
    const order = String(settings.order || '');
    const input = stepInputModel(settings, { kind: 'round', first, earlier, drafts });
    const stepsMode = input?.value === 'steps';
    const defaultInput = first ? 'none' : 'previous';
    const effectiveInput = stepsMode ? 'steps' : (input?.value || defaultInput);
    return {
      disabled: Boolean(disabled),
      order: { value: order, options: [{ value: '', label: `По умолчанию (${ORDER_LABELS.parallel.toLowerCase()})` }, ...Object.entries(ORDER_LABELS).map(([value, label]) => ({ value, label }))] },
      input,
      // The task is always shown. With the input nothing only the task written here is sent (the shared one is not), so the
      // placeholder of the shared task stays empty and the label says so. «выбранные этапы» sends the step's answers, so the task goes.
      task: { value: String(settings.task || ''), placeholder: effectiveInput === 'none' ? '' : String(inheritedTask || ''), sent: effectiveInput !== 'none' },
      ...stepRestModel(settings, { enabledCount, drafts })
    };
  }

  // A select row of a card (order, input): the choice goes to emit(field, value).
  function choiceRow(container, field, label, data, emit) {
    const doc = container.ownerDocument;
    const select = el(doc, 'select', `stage-card-${field}-select`);
    data.options.forEach((item) => { const option = el(doc, 'option', '', item.label); option.value = item.value; select.append(option); });
    select.value = data.value;
    select.disabled = Boolean(data.disabled);
    select.addEventListener('change', () => emit(field, select.value));
    const wrap = el(doc, 'label', `stage-card-setting stage-card-${field}`);
    wrap.append(doc.createTextNode(`${label} `), select);
    container.append(wrap);
  }

  // The list of steps of the input «выбранные этапы». emit('steps', { ref, checked }) — the page keeps the order of choice.
  // The number is the place of the step in the owner's list; a switched-off step is marked, not hidden.
  function renderSteps(container, input, emit, disabled = false) {
    const doc = container.ownerDocument;
    const box = el(doc, 'fieldset', 'stage-card-steps');
    box.append(el(doc, 'legend', '', 'Этапы для входа (номер — порядок выбора)'));
    if (!input.steps.length) box.append(el(doc, 'p', 'stage-card-muted', 'Раньше этих шагов нет.'));
    input.steps.forEach((item) => {
      const row = el(doc, 'label', 'stage-card-step-option');
      const check = el(doc, 'input');
      check.type = 'checkbox';
      check.checked = item.checked;
      check.disabled = Boolean(disabled);
      check.addEventListener('change', () => emit('steps', { ref: item.ref, checked: check.checked }));
      row.append(check, doc.createTextNode(` ${item.label}${item.disabled ? ' (выключен)' : ''}${item.number ? ` · ${item.number}` : ''}`));
      box.append(row);
    });
    if (input.objectRefs) box.append(el(doc, 'p', 'stage-card-muted', `Ссылки на участников и артефакты (${input.objectRefs}) заданы в JSON и сохраняются.`));
    container.append(box);
  }

  // The fields after the task: how many answers are needed, the owner's approval, the output of the step.
  // A number of answers goes to emit('require', n) only when it is typed; 'count' is the choice of a number.
  function renderRest(container, fields, emit) {
    const doc = container.ownerDocument;
    const disabled = Boolean(fields.disabled);
    const requireSelect = el(doc, 'select', 'stage-card-require-select');
    fields.require.options.forEach((item) => { const option = el(doc, 'option', '', item.label); option.value = item.value; requireSelect.append(option); });
    requireSelect.value = fields.require.value;
    requireSelect.disabled = disabled;
    requireSelect.addEventListener('change', () => emit('require', requireSelect.value));
    const requireWrap = el(doc, 'label', 'stage-card-setting stage-card-require');
    requireWrap.append(doc.createTextNode('Сколько ответов нужно '), requireSelect);
    if (fields.require.value === 'count') {
      const count = el(doc, 'input', 'stage-card-require-count');
      count.type = 'number';
      count.min = '1';
      count.max = String(fields.require.max);
      count.step = '1';
      count.value = fields.require.count === '' ? '' : String(fields.require.count);
      count.disabled = disabled;
      count.setAttribute('aria-label', 'Число ответов');
      count.addEventListener('change', () => { if (count.value !== '') emit('require', Number(count.value)); });
      requireWrap.append(count, doc.createTextNode(` из ${fields.require.max}`));
    }
    container.append(requireWrap);

    const ownerBox = el(doc, 'input', 'stage-card-owner-check');
    ownerBox.type = 'checkbox';
    ownerBox.checked = fields.owner.checked;
    ownerBox.disabled = disabled;
    ownerBox.addEventListener('change', () => emit('owner', ownerBox.checked ? 'approve' : ''));
    const ownerWrap = el(doc, 'label', 'stage-card-setting stage-card-owner');
    ownerWrap.append(ownerBox, doc.createTextNode(' Спросить владельца после этапа'));
    container.append(ownerWrap);

    const output = fields.output;
    const group = el(doc, 'section', 'stage-card-output');
    group.append(el(doc, 'h3', '', 'Выход этапа'));
    const nameInput = el(doc, 'input', 'stage-card-output-name');
    nameInput.type = 'text';
    nameInput.value = output.name;
    nameInput.disabled = disabled;
    nameInput.setAttribute('aria-label', 'Имя результата');
    const formArea = el(doc, 'textarea', 'stage-card-output-form');
    formArea.rows = 2;
    formArea.value = output.form;
    formArea.disabled = disabled;
    formArea.setAttribute('aria-label', 'Форма ответа');
    const sectionsArea = el(doc, 'textarea', 'stage-card-output-sections');
    sectionsArea.rows = 3;
    sectionsArea.value = output.sections;
    sectionsArea.disabled = disabled || output.json;
    sectionsArea.setAttribute('aria-label', 'Разделы ответа, по одному на строку');
    const strict = el(doc, 'input', 'stage-card-output-strict');
    strict.type = 'checkbox';
    strict.checked = output.strictLength;
    strict.disabled = disabled;
    const emitOutput = () => emit('output', { name: nameInput.value, form: formArea.value, sections: sectionsArea.value.split('\n'), strictLength: strict.checked });
    [[nameInput, 'Имя результата'], [formArea, 'Форма ответа'], [sectionsArea, 'Разделы ответа (по одному на строку)']].forEach(([node, text]) => {
      const wrap = el(doc, 'label', 'stage-card-output-field');
      wrap.append(doc.createTextNode(`${text} `), node);
      group.append(wrap);
      node.addEventListener('change', emitOutput);
    });
    const strictWrap = el(doc, 'label', 'stage-card-output-field');
    strictWrap.append(strict, doc.createTextNode(' Строгая длина (предел слов)'));
    group.append(strictWrap);
    strict.addEventListener('change', emitOutput);
    if (output.json) group.append(el(doc, 'p', 'stage-card-muted', 'Формат json: заголовки не проверяются, поля задаются в схеме (requiredFields).'));
    container.append(group);
  }

  // The window of a synthesis: its input (with the steps list), then the same fields as a round card has after its task.
  function renderStepFields(container, fields, onField) {
    const emit = (field, value) => { if (typeof onField === 'function') onField(field, value); };
    if (fields.input) {
      choiceRow(container, 'input', 'Вход синтеза', { ...fields.input, disabled: fields.disabled }, emit);
      if (fields.input.value === 'steps') renderSteps(container, fields.input, emit, fields.disabled);
    }
    renderRest(container, fields, emit);
  }

  const el = (documentRef, tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function render(container, model, { onCopy = null, onRole = null, onRoundPrompt = null, onSetting = null, addControl = null } = {}) {
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
        choiceRow(container, 'order', 'Порядок работы', { ...settings.order, disabled: settings.disabled }, emit);
        if (settings.input) choiceRow(container, 'input', 'Вход раунда', { ...settings.input, disabled: settings.disabled }, emit);
        if (settings.input?.value === 'steps') renderSteps(container, settings.input, emit, settings.disabled);
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
          wrap.append(doc.createTextNode(settings.task.sent ? 'Задание раунда (пусто — общее) ' : 'Задание раунда (при входе «ничего» отправляется только оно) '), area);
          container.append(wrap);
        }
        renderRest(container, settings, emit);
        if (addControl) renderAddControl(container, addControl);
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

  // The run feed of Basic (results.js): pure texts of the events and of the answer cards. Old events without the
  // new fields give the same text as before; a participant id equal to the model name is not repeated.
  const ROUTE_REASON = {
    rule: 'по правилу', otherwise: 'иначе', model: 'выбрала модель', owner: 'выбрал владелец',
    conflict_first: 'первый из подходящих', conflict_owner: 'выбрал владелец из подходящих',
    invalid_route: 'ответ модели не распознан, выбрал владелец'
  };
  const feed = Object.freeze({
    // The label of an answer card: the step, the participant (when it is not the model) and the visit (from the second).
    role({ label = '', modelName = '', participantId = '', visit = 1 } = {}) {
      const parts = [`Basic · ${label}`];
      if (participantId && participantId !== modelName) parts.push(`участник ${participantId}`);
      if (Number(visit) > 1) parts.push(`заход ${visit}`);
      return parts.join(' · ');
    },
    gate({ ref = '', pass = false, unmet = [] } = {}) {
      const head = `Проверка ${ref}: ${pass ? 'пройдена' : 'не пройдена'}`;
      return !pass && unmet.length ? `${head}. Не выполнено: ${unmet.join('; ')}` : head;
    },
    route({ ref = '', caseLabel = '', reason = '' } = {}) {
      return `Маршрут ${ref}: вариант «${caseLabel}», ${ROUTE_REASON[reason] || reason}`;
    },
    // stopText: the text of a stop reason (the engine's STOP_TEXT); a limit names its count.
    transition({ from = '', to = '', action = 'goto', count = null, maxLoops = null, reason = '' } = {}, stopText = (value) => value) {
      if (action === 'stop') {
        return reason === 'loop_limit'
          ? `Переход ${from} → ${to} не выполнен: лимит ${maxLoops} исчерпан`
          : `Прогон остановлен после ${from}: ${stopText(reason)}`;
      }
      const head = `${action === 'return' ? 'Возврат' : 'Переход'} ${from} → ${to}`;
      return count != null && maxLoops != null ? `${head}, переход ${count} из ${maxLoops}` : head;
    },
    // The title of an artifact in the registry: name, participant (owner for an owner step), visit, validity.
    artifactTitle({ name = '', source = {}, valid = true } = {}) {
      const author = source.participant === 'owner' ? 'владелец' : `участник ${source.participant}`;
      return `${name} · ${author} · заход ${source.visit}${valid === false ? ' · устарело' : ''}`;
    },
    // The text of an artifact: the whole answer for an empty pointer, else the value at the pointer (JSON as text).
    artifactText(answer = '', pointer = '', readPointer) {
      if (!pointer) return String(answer || '');
      let value;
      try { value = JSON.parse(answer); } catch (_) { return `Указатель ${pointer}: ответ не является JSON.`; }
      const read = readPointer(value, pointer);
      if (!read.found) return `Указатель ${pointer} не найден в ответе.`;
      return typeof read.value === 'string' ? read.value : JSON.stringify(read.value, null, 2);
    }
  });

  // Control steps (6.1–6.3 of the spec): a gate, a route and an owner are cards on the canvas. A window edits only the fields
  // listed here; controlAfterEdit gives back the whole step, so every other field stays as it is.
  const isTransition = (value) => isPlain(value) && typeof value.goto === 'string';
  // The view of a transition (onPass, onFail, a case's action, otherwise): `absent` is the mode of a missing value.
  // A value the window does not edit (its shape is other) gives mode 'json'.
  function transitionView(value, absent) {
    if (value === undefined || value === null) return { mode: absent };
    if (value === 'stop' || value === 'ask') return { mode: value };
    if (isTransition(value)) return { mode: 'goto', goto: value.goto, maxLoops: value.maxLoops ?? '' };
    if (isPlain(value) && Object.keys(value).length === 1 && typeof value.stop === 'string') return { mode: 'stop', stop: value.stop };
    if (isPlain(value) && value.return === true && Object.keys(value).every((key) => key === 'return' || key === 'maxLoops')) return { mode: 'return', maxLoops: value.maxLoops ?? '' };
    return { mode: 'json' };
  }
  // The value of a transition after an edit (`kind`: pass, fail, action, otherwise). A missing value is undefined.
  // A goto keeps its feedback, invalidate and resumeAt: the window does not edit them.
  function transitionAfterEdit(current, edit = {}, kind = 'action') {
    if (edit.mode === 'next' || edit.mode === 'none') return undefined;
    const limit = edit.maxLoops === '' || edit.maxLoops == null ? {} : { maxLoops: Number(edit.maxLoops) };
    if (edit.mode === 'ask') return 'ask';
    if (edit.mode === 'stop') return kind === 'fail' ? 'stop' : { stop: String(edit.stop ?? '') };
    if (edit.mode === 'return') return { return: true, ...limit };
    if (edit.mode === 'goto') {
      const kept = isTransition(current) ? Object.fromEntries(Object.entries(current).filter(([key]) => key !== 'goto' && key !== 'maxLoops')) : {};
      return { ...kept, goto: String(edit.goto ?? ''), ...limit };
    }
    return current;
  }

  // The window of a gate: criteria (one per line), its checkers (the available models; an unchecked one stays in the
  // schema with enabled false), pass, and the transitions onFail and onPass. `names` are the models the page offers.
  function gateWindowModel(step = {}, { names = [], refs = [], disabled = false } = {}) {
    const models = Array.isArray(step.models) ? step.models.filter(isPlain) : [];
    const checked = new Set(models.filter((model) => model.enabled !== false).map((model) => String(model.name)));
    const known = [...new Set([...names.map(String), ...models.map((model) => String(model.name))])];
    return {
      ref: String(step.ref || ''),
      disabled: Boolean(disabled),
      criteria: Array.isArray(step.criteria) ? step.criteria.map(String).join('\n') : '',
      checkers: known.map((name) => ({ name, checked: checked.has(name) })),
      pass: typeof step.pass === 'string' ? step.pass : '',
      onFail: transitionView(step.onFail, 'stop'),
      onPass: transitionView(step.onPass, 'next'),
      refs: refs.map(String).filter((ref) => ref !== String(step.ref || ''))
    };
  }
  // An edit of a gate: { field: 'criteria', value } | { field: 'checker', name, checked } | { field: 'pass', value } |
  // { field: 'onFail' | 'onPass', mode, goto, maxLoops, stop }. Returns the new step; the input is not changed.
  function gateAfterEdit(step = {}, edit = {}) {
    const next = { ...step };
    if (edit.field === 'criteria') {
      const lines = String(edit.value || '').split('\n').map((line) => line.trim()).filter(Boolean);
      if (lines.length) next.criteria = lines;
      else delete next.criteria;
    } else if (edit.field === 'checker') {
      const models = Array.isArray(step.models) ? step.models.map((model) => (isPlain(model) ? { ...model } : model)) : [];
      const at = models.findIndex((model) => isPlain(model) && model.name === edit.name);
      if (at < 0 && edit.checked) models.push({ name: String(edit.name) });
      else if (at >= 0 && edit.checked) delete models[at].enabled;
      else if (at >= 0) models[at].enabled = false;
      next.models = models;
    } else if (edit.field === 'pass') {
      if (edit.value === 'all' || edit.value === 'any') next.pass = edit.value;
      else delete next.pass;
    } else if (edit.field === 'onFail' || edit.field === 'onPass') {
      const key = edit.field;
      const value = transitionAfterEdit(step[key], edit, key === 'onFail' ? 'fail' : 'pass');
      if (value === undefined) delete next[key];
      else next[key] = value;
    }
    return next;
  }

  // The window's controls: a select of a transition with its target (a ref of the canvas) and the number of loops.
  // The change goes to emit(field, { mode, goto, maxLoops, stop }); a goto without a target is sent as it is (the schema says so).
  function renderTransition(container, { field, label, view, options, refs, disabled, withStop, emit }) {
    const doc = container.ownerDocument;
    const state = { mode: view.mode, goto: view.goto || '', maxLoops: view.maxLoops ?? '', stop: view.stop || '' };
    const box = el(doc, 'fieldset', `stage-card-transition stage-card-${field}`);
    box.append(el(doc, 'legend', '', label));
    const mode = el(doc, 'select', `stage-card-${field}-mode`);
    mode.setAttribute('aria-label', label);
    const choices = state.mode === 'json' ? [...options, { value: 'json', label: 'задан в JSON, сохраняется как есть', disabled: true }] : options;
    choices.forEach((item) => { const option = el(doc, 'option', '', item.label); option.value = item.value; option.disabled = Boolean(item.disabled); mode.append(option); });
    mode.value = state.mode;
    mode.disabled = Boolean(disabled) || state.mode === 'json';
    const send = () => { if (typeof emit === 'function') emit({ field, mode: state.mode, goto: state.goto, maxLoops: state.maxLoops, stop: state.stop }); };
    mode.addEventListener('change', () => { state.mode = mode.value; send(); });
    box.append(mode);
    if (state.mode === 'goto' || state.mode === 'return') {
      if (state.mode === 'goto') {
        const target = el(doc, 'select', `stage-card-${field}-goto`);
        target.setAttribute('aria-label', `${label}: переход на шаг`);
        target.append(new Option('— выберите шаг —', ''));
        [...new Set([...refs, state.goto].filter(Boolean))].forEach((ref) => target.append(new Option(ref, ref)));
        target.value = state.goto;
        target.disabled = Boolean(disabled);
        target.addEventListener('change', () => { state.goto = target.value; send(); });
        box.append(target);
      }
      const loops = el(doc, 'input', `stage-card-${field}-loops`);
      loops.type = 'number'; loops.min = '1'; loops.max = '5'; loops.step = '1';
      loops.value = state.maxLoops === '' ? '' : String(state.maxLoops);
      loops.placeholder = 'лимит 1–5';
      loops.disabled = Boolean(disabled);
      loops.setAttribute('aria-label', `${label}: лимит переходов`);
      loops.addEventListener('change', () => { state.maxLoops = loops.value; send(); });
      box.append(loops);
    }
    if (withStop && state.mode === 'stop') {
      const reason = el(doc, 'input', `stage-card-${field}-stop`);
      reason.type = 'text'; reason.value = state.stop; reason.disabled = Boolean(disabled);
      reason.setAttribute('aria-label', `${label}: причина остановки`);
      reason.addEventListener('change', () => { state.stop = reason.value; send(); });
      box.append(reason);
    }
    container.append(box);
  }

  // The window of a gate. Every change goes to emit(edit) with the edit's field (see gateAfterEdit).
  function renderGateWindow(container, model, emit) {
    const doc = container.ownerDocument;
    const disabled = Boolean(model.disabled);
    const send = (edit) => { if (typeof emit === 'function') emit(edit); };
    const criteria = el(doc, 'textarea', 'stage-card-criteria');
    criteria.rows = 4;
    criteria.value = model.criteria;
    criteria.disabled = disabled;
    criteria.spellcheck = false;
    criteria.setAttribute('aria-label', 'Критерии проверки, по одному на строку');
    criteria.addEventListener('change', () => send({ field: 'criteria', value: criteria.value }));
    const critWrap = el(doc, 'label', 'stage-card-setting stage-card-criteria-label');
    critWrap.append(doc.createTextNode('Критерии (по одному на строку) '), criteria);
    container.append(critWrap);

    const checkers = el(doc, 'fieldset', 'stage-card-checkers');
    checkers.append(el(doc, 'legend', '', 'Проверяющие'));
    model.checkers.forEach((item) => {
      const row = el(doc, 'label', 'stage-card-checker');
      const check = el(doc, 'input', 'stage-card-checker-check');
      check.type = 'checkbox';
      check.checked = item.checked;
      check.disabled = disabled;
      check.addEventListener('change', () => send({ field: 'checker', name: item.name, checked: check.checked }));
      row.append(check, doc.createTextNode(` ${item.name}`));
      checkers.append(row);
    });
    if (!model.checkers.length) checkers.append(el(doc, 'p', 'stage-card-muted', 'Моделей нет.'));
    container.append(checkers);

    const pass = el(doc, 'select', 'stage-card-pass-select');
    [['', 'По умолчанию (все проверяющие)'], ['all', 'Все проверяющие прошли'], ['any', 'Достаточно одного']].forEach(([value, label]) => {
      const option = el(doc, 'option', '', label); option.value = value; pass.append(option);
    });
    pass.value = model.pass;
    pass.disabled = disabled;
    pass.setAttribute('aria-label', 'Проверка прошла, если');
    pass.addEventListener('change', () => send({ field: 'pass', value: pass.value }));
    const passWrap = el(doc, 'label', 'stage-card-setting stage-card-pass');
    passWrap.append(doc.createTextNode('Проходит, если '), pass);
    container.append(passWrap);

    renderTransition(container, { field: 'onFail', label: 'При провале', view: model.onFail, refs: model.refs, disabled, withStop: false, emit: send,
      options: [{ value: 'stop', label: 'Остановить прогон' }, { value: 'ask', label: 'Спросить владельца' }, { value: 'goto', label: 'Перейти к шагу' }] });
    renderTransition(container, { field: 'onPass', label: 'После успеха', view: model.onPass, refs: model.refs, disabled, withStop: false, emit: send,
      options: [{ value: 'next', label: 'Следующий шаг' }, { value: 'goto', label: 'Перейти к шагу' }] });
  }

  // The window of a route (6.2). `by` rule reads the step's input (the sources numbered in the conditions); model gives the
  // one model that chooses and its task; owner gives nothing (the owner chooses). A composite condition (all, any) is kept as it is.
  const ROUTE_BY_LABELS = [['', '— выберите —'], ['rule', 'По правилу (условие на данных)'], ['model', 'Выбирает модель'], ['owner', 'Выбирает владелец']];
  const ROUTE_CONFLICT_LABELS = [['', 'По умолчанию: остановить'], ['first', 'Первый подходящий'], ['owner', 'Выбирает владелец']];
  const ROUTE_OPS = ['eq', 'in', 'exists'];
  const isComposite = (cond) => isPlain(cond) && (Array.isArray(cond.all) || Array.isArray(cond.any));
  // A value as the window shows it: a string as it is, anything else as JSON.
  const valueText = (value) => (typeof value === 'string' ? value : JSON.stringify(value));
  // A value typed in the window: JSON when it parses (a number, true, a quoted text), else the text itself.
  const parseValue = (text) => { try { return JSON.parse(text); } catch (_) { return String(text); } };
  // The list of `in` is written by comma; each item is read as a value.
  const parseList = (text) => String(text || '').split(',').map((item) => item.trim()).filter(Boolean).map(parseValue);
  function caseView(item = {}) {
    const cond = item.when;
    const composite = isComposite(cond);
    const when = composite || !isPlain(cond) ? null : {
      source: cond.source ?? '', pointer: String(cond.pointer ?? ''), op: ROUTE_OPS.includes(cond.op) ? cond.op : 'eq',
      value: Array.isArray(cond.value) ? cond.value.map(valueText).join(', ') : (cond.value === undefined ? '' : valueText(cond.value))
    };
    return { id: String(item.id ?? ''), label: String(item.label ?? ''), composite, when, action: transitionView(item.action, 'goto') };
  }
  // The sources of a rule: the answers of the participants of the steps before this one (`earlier`: [{ ref, label,
  // participants: [{ id, name }] }]). The number of a source is its place in the input (from 0, as the conditions read it).
  const isParticipantSource = (src) => isPlain(src) && typeof src.step === 'string' && 'participant' in src && !('artifact' in src);
  function routeWindowModel(step = {}, { names = [], refs = [], earlier = [], disabled = false } = {}) {
    const select = isPlain(step.select) ? step.select : {};
    const models = Array.isArray(step.models) ? step.models.filter(isPlain) : [];
    const chosen = models.find((model) => model.enabled !== false);
    const input = Array.isArray(step.input) ? step.input : [];
    const sources = earlier.flatMap((item) => item.participants.map((participant) => {
      const at = input.findIndex((src) => isParticipantSource(src) && src.step === item.ref && src.participant === participant.id);
      return { step: item.ref, participant: participant.id, label: `${item.label} · ${participant.name}`, checked: at >= 0, number: at };
    }));
    return {
      ref: String(step.ref || ''),
      disabled: Boolean(disabled),
      refs: refs.map(String).filter((ref) => ref !== String(step.ref || '')),
      by: typeof select.by === 'string' ? select.by : '',
      modelNames: [...new Set([...names.map(String), ...models.map((model) => String(model.name))])],
      model: chosen ? String(chosen.name) : '',
      task: typeof step.task === 'string' ? step.task : '',
      sources,
      otherSources: input.filter((src) => !isParticipantSource(src)).length,
      conflict: typeof select.conflict === 'string' ? select.conflict : '',
      otherwise: transitionView(select.otherwise, 'none'),
      cases: (Array.isArray(select.cases) ? select.cases : []).map(caseView)
    };
  }
  // An edit of a route: { field: 'by', value } | { field: 'model', value } | { field: 'task', value } | { field: 'conflict', value } |
  // { field: 'source', step, participant, checked } | { field: 'otherwise', mode, goto, maxLoops, stop } | { field: 'caseAdd' } | { field: 'caseRemove', index } |
  // { field: 'case', index, id, label, when (null: none; undefined: kept), action: { mode, goto, maxLoops, stop } }.
  // Changing `by` drops what the new kind does not have: the conditions and the otherwise away from a rule, the models
  // away from a model, the model and the task away from a rule and an owner.
  function routeAfterEdit(step = {}, edit = {}) {
    const next = { ...step };
    const select = isPlain(step.select) ? { ...step.select } : {};
    const cases = Array.isArray(select.cases) ? select.cases.map((item) => ({ ...item })) : [];
    const put = (target, key, value) => { if (value === '' || value === undefined || value === null) delete target[key]; else target[key] = value; };
    if (edit.field === 'by') {
      put(select, 'by', edit.value);
      if (edit.value !== 'rule') {
        delete select.conflict;
        delete select.otherwise;
        cases.forEach((item) => { delete item.when; });
      }
      if (edit.value === 'rule' || edit.value === 'owner') next.models = [];
      if (edit.value === 'owner') delete next.task;
    } else if (edit.field === 'source') {
      // The sources of a rule are kept in the input in their order; an entry the window does not show stays where it is.
      const input = Array.isArray(step.input) ? step.input.map((src) => (isPlain(src) ? { ...src } : src)) : [];
      const at = input.findIndex((src) => isParticipantSource(src) && src.step === edit.step && src.participant === edit.participant);
      if (edit.checked && at < 0) input.push({ step: String(edit.step), participant: edit.participant });
      else if (!edit.checked && at >= 0) input.splice(at, 1);
      if (input.length) next.input = input;
      else delete next.input;
    } else if (edit.field === 'model') {
      next.models = edit.value ? [{ name: String(edit.value) }] : [];
    } else if (edit.field === 'task') {
      put(next, 'task', edit.value);
    } else if (edit.field === 'conflict') {
      put(select, 'conflict', edit.value);
    } else if (edit.field === 'otherwise') {
      const value = transitionAfterEdit(select.otherwise, edit, 'otherwise');
      put(select, 'otherwise', value);
    } else if (edit.field === 'caseAdd') {
      const taken = new Set(cases.map((item) => item.id));
      let n = cases.length + 1;
      while (taken.has(`case${n}`)) n += 1;
      cases.push({ id: `case${n}` });
    } else if (edit.field === 'caseRemove') {
      cases.splice(Number(edit.index), 1);
    } else if (edit.field === 'case' && cases[Number(edit.index)]) {
      const at = Number(edit.index);
      const current = cases[at];
      const updated = { id: String(edit.id ?? current.id ?? '') };
      if (String(edit.label ?? '').trim()) updated.label = String(edit.label);
      if (current.when !== undefined) updated.when = current.when;
      if (edit.when === null) delete updated.when;
      else if (isPlain(edit.when)) {
        // An empty source is not a number: it is left out, and the schema names the error at its place.
        const cond = { ...(String(edit.when.source ?? '').trim() === '' ? {} : { source: Number(edit.when.source) }), pointer: String(edit.when.pointer ?? ''), op: edit.when.op };
        if (edit.when.op !== 'exists') cond.value = edit.when.op === 'in' ? parseList(edit.when.value) : parseValue(String(edit.when.value ?? ''));
        updated.when = cond;
      }
      const action = transitionAfterEdit(current.action, edit.action, 'action');
      if (action !== undefined) updated.action = action;
      cases[at] = updated;
    }
    select.cases = cases;
    next.select = select;
    return next;
  }
  // The window of a route: the choice, the model and the task (model), the conditions and the cases with their actions,
  // the otherwise and the conflict (rule). Every change goes to emit(edit) with the field (see routeAfterEdit).
  function renderRouteWindow(container, model, emit) {
    const doc = container.ownerDocument;
    const disabled = Boolean(model.disabled);
    const send = (edit) => { if (typeof emit === 'function') emit(edit); };
    const choose = (field, label, options, value, onChange) => {
      const select = el(doc, 'select', `stage-card-route-${field}`);
      options.forEach(([optionValue, text]) => { const option = el(doc, 'option', '', text); option.value = optionValue; select.append(option); });
      select.value = value;
      select.disabled = disabled;
      select.setAttribute('aria-label', label);
      select.addEventListener('change', () => onChange(select.value));
      const wrap = el(doc, 'label', `stage-card-setting stage-card-route-${field}-label`);
      wrap.append(doc.createTextNode(`${label} `), select);
      container.append(wrap);
      return select;
    };
    choose('by', 'Выбор варианта', ROUTE_BY_LABELS, model.by, (value) => send({ field: 'by', value }));
    if (model.by === 'model') {
      choose('model', 'Модель, которая выбирает', [['', '— выберите модель —'], ...model.modelNames.map((name) => [name, name])], model.model, (value) => send({ field: 'model', value }));
      const task = el(doc, 'textarea', 'stage-card-route-task');
      task.rows = 3; task.value = model.task; task.disabled = disabled; task.spellcheck = false;
      task.setAttribute('aria-label', 'Задание модели, которая выбирает вариант');
      task.addEventListener('change', () => send({ field: 'task', value: task.value }));
      const wrap = el(doc, 'label', 'stage-card-setting stage-card-route-task-label');
      wrap.append(doc.createTextNode('Задание модели '), task);
      container.append(wrap);
    }
    if (model.by === 'rule') {
      const sources = el(doc, 'fieldset', 'stage-card-route-sources');
      sources.append(el(doc, 'legend', '', 'Источники условия (номер — место в списке входа, с 0)'));
      if (!model.sources.length) sources.append(el(doc, 'p', 'stage-card-muted', 'Раньше нет участников с ответами.'));
      model.sources.forEach((src) => {
        const row = el(doc, 'label', 'stage-card-source');
        const check = el(doc, 'input', 'stage-card-source-check');
        check.type = 'checkbox';
        check.checked = src.checked;
        check.disabled = disabled;
        check.addEventListener('change', () => send({ field: 'source', step: src.step, participant: src.participant, checked: check.checked }));
        row.append(check, doc.createTextNode(` ${src.label}${src.checked ? ` · источник ${src.number}` : ''}`));
        sources.append(row);
      });
      if (model.otherSources) sources.append(el(doc, 'p', 'stage-card-muted', `Ещё источников: ${model.otherSources} (заданы в JSON, сохраняются как есть).`));
      container.append(sources);
      choose('conflict', 'Если подошло несколько', ROUTE_CONFLICT_LABELS, model.conflict, (value) => send({ field: 'conflict', value }));
    }
    const cases = el(doc, 'fieldset', 'stage-card-cases');
    cases.append(el(doc, 'legend', '', 'Варианты'));
    if (!model.cases.length) cases.append(el(doc, 'p', 'stage-card-muted', 'Вариантов нет.'));
    const sendCase = (index, state) => send({ field: 'case', index, id: state.id, label: state.label, when: state.when, action: state.action });
    model.cases.forEach((item, index) => {
      const box = el(doc, 'div', 'stage-card-case');
      const state = { id: item.id, label: item.label, when: model.by === 'rule' ? (item.composite ? undefined : item.when) : null, action: { ...item.action } };
      const idInput = el(doc, 'input', 'stage-card-case-id');
      idInput.type = 'text'; idInput.value = item.id; idInput.disabled = disabled; idInput.placeholder = 'ID варианта';
      idInput.setAttribute('aria-label', 'ID варианта');
      idInput.addEventListener('change', () => { state.id = idInput.value; sendCase(index, state); });
      const labelInput = el(doc, 'input', 'stage-card-case-label');
      labelInput.type = 'text'; labelInput.value = item.label; labelInput.disabled = disabled; labelInput.placeholder = 'название для выбора';
      labelInput.setAttribute('aria-label', 'Название варианта');
      labelInput.addEventListener('change', () => { state.label = labelInput.value; sendCase(index, state); });
      box.append(idInput, labelInput);
      if (model.by === 'rule') {
        if (item.composite) box.append(el(doc, 'p', 'stage-card-muted', 'Составное условие (all/any): сохраняется как есть, в JSON.'));
        else {
          const when = item.when || { source: '', pointer: '', op: 'eq', value: '' };
          const source = el(doc, 'input', 'stage-card-case-source');
          source.type = 'number'; source.min = '0'; source.step = '1'; source.value = String(when.source); source.disabled = disabled;
          source.setAttribute('aria-label', 'Источник: номер входа');
          const pointer = el(doc, 'input', 'stage-card-case-pointer');
          pointer.type = 'text'; pointer.value = when.pointer; pointer.placeholder = '/route'; pointer.disabled = disabled;
          pointer.setAttribute('aria-label', 'Указатель JSON');
          const op = el(doc, 'select', 'stage-card-case-op');
          ROUTE_OPS.forEach((value) => { const option = el(doc, 'option', '', value); option.value = value; op.append(option); });
          op.value = when.op; op.disabled = disabled; op.setAttribute('aria-label', 'Оператор условия');
          const value = el(doc, 'input', 'stage-card-case-value');
          value.type = 'text'; value.value = when.value; value.disabled = disabled || when.op === 'exists';
          value.placeholder = when.op === 'in' ? 'значения через запятую' : 'значение (текст или JSON)';
          value.setAttribute('aria-label', 'Значение условия');
          const condition = () => ({ source: source.value, pointer: pointer.value, op: op.value, value: value.value });
          const onCondition = () => { state.when = condition(); value.disabled = op.value === 'exists'; sendCase(index, state); };
          source.addEventListener('change', onCondition);
          pointer.addEventListener('change', onCondition);
          op.addEventListener('change', onCondition);
          value.addEventListener('change', onCondition);
          box.append(source, pointer, op, value);
        }
      }
      renderTransition(box, { field: `case${index}`, label: 'Действие варианта', view: item.action, refs: model.refs, disabled, withStop: true,
        options: [{ value: 'goto', label: 'Перейти к шагу' }, { value: 'stop', label: 'Остановить прогон' }, { value: 'return', label: 'Вернуться' }],
        emit: (payload) => { state.action = { mode: payload.mode, goto: payload.goto, maxLoops: payload.maxLoops, stop: payload.stop }; sendCase(index, state); } });
      const remove = el(doc, 'button', 'stage-card-case-remove', '×');
      remove.type = 'button'; remove.disabled = disabled; remove.setAttribute('aria-label', 'Удалить вариант');
      remove.addEventListener('click', () => send({ field: 'caseRemove', index }));
      box.append(remove);
      cases.append(box);
    });
    const add = el(doc, 'button', 'stage-card-case-add', '+ вариант');
    add.type = 'button'; add.disabled = disabled;
    add.addEventListener('click', () => send({ field: 'caseAdd' }));
    cases.append(add);
    container.append(cases);
    if (model.by === 'rule') {
      renderTransition(container, { field: 'otherwise', label: 'Если ни один не подошёл', view: model.otherwise, refs: model.refs, disabled, withStop: true, emit: send,
        options: [{ value: 'none', label: 'Нет: ошибка маршрута' }, { value: 'goto', label: 'Перейти к шагу' }, { value: 'stop', label: 'Остановить прогон' }, { value: 'return', label: 'Вернуться' }] });
    }
  }

  // The window of an owner (6.1 of the spec, 8.1): the task the owner has to provide and the output of the step (as the round
  // windows have it). The input of an owner is not edited here; it stays as the schema has it.
  function ownerWindowModel(step = {}, { disabled = false } = {}) {
    const output = isPlain(step.output) ? step.output : {};
    return {
      ref: String(step.ref || ''),
      disabled: Boolean(disabled),
      task: typeof step.task === 'string' ? step.task : '',
      output: {
        name: String(output.name || ''),
        form: String(output.form || ''),
        sections: Array.isArray(output.sections) ? output.sections.map(String).join('\n') : '',
        strictLength: output.strictLength === true,
        json: output.format === 'json'
      }
    };
  }
  // An edit of an owner: { field: 'task', value } | { field: 'output', value: { name, form, sections (lines), strictLength } }.
  function ownerAfterEdit(step = {}, edit = {}) {
    const next = { ...step };
    if (edit.field === 'task') {
      if (String(edit.value || '').trim()) next.task = String(edit.value);
      else delete next.task;
    } else if (edit.field === 'output') {
      const output = outputAfterEdit(step.output, edit.value);
      if (Object.keys(output).length) next.output = output;
      else delete next.output;
    }
    return next;
  }
  // The window of an owner. A change goes to emit(edit) with the field (see ownerAfterEdit).
  function renderOwnerWindow(container, model, emit) {
    const doc = container.ownerDocument;
    const disabled = Boolean(model.disabled);
    const send = (edit) => { if (typeof emit === 'function') emit(edit); };
    const task = el(doc, 'textarea', 'stage-card-owner-task');
    task.rows = 4; task.value = model.task; task.disabled = disabled; task.spellcheck = false;
    task.setAttribute('aria-label', 'Что должен предоставить владелец');
    task.addEventListener('change', () => send({ field: 'task', value: task.value }));
    const taskWrap = el(doc, 'label', 'stage-card-setting stage-card-owner-task-label');
    taskWrap.append(doc.createTextNode('Что должен предоставить владелец '), task);
    container.append(taskWrap);

    const output = model.output;
    const group = el(doc, 'section', 'stage-card-output');
    group.append(el(doc, 'h3', '', 'Выход этапа'));
    const name = el(doc, 'input', 'stage-card-output-name');
    name.type = 'text'; name.value = output.name; name.disabled = disabled; name.setAttribute('aria-label', 'Имя результата');
    const form = el(doc, 'textarea', 'stage-card-output-form');
    form.rows = 2; form.value = output.form; form.disabled = disabled; form.setAttribute('aria-label', 'Форма ответа');
    const sections = el(doc, 'textarea', 'stage-card-output-sections');
    sections.rows = 3; sections.value = output.sections; sections.disabled = disabled || output.json;
    sections.setAttribute('aria-label', 'Разделы ответа, по одному на строку');
    const strict = el(doc, 'input', 'stage-card-output-strict');
    strict.type = 'checkbox'; strict.checked = output.strictLength; strict.disabled = disabled;
    const emitOutput = () => send({ field: 'output', value: { name: name.value, form: form.value, sections: sections.value.split('\n'), strictLength: strict.checked } });
    [[name, 'Имя результата'], [form, 'Форма ответа'], [sections, 'Разделы ответа (по одному на строку)']].forEach(([node, text]) => {
      const wrap = el(doc, 'label', 'stage-card-output-field');
      wrap.append(doc.createTextNode(`${text} `), node);
      group.append(wrap);
      node.addEventListener('change', emitOutput);
    });
    const strictWrap = el(doc, 'label', 'stage-card-output-field');
    strictWrap.append(strict, doc.createTextNode(' Строгая длина (предел слов)'));
    group.append(strictWrap);
    strict.addEventListener('change', emitOutput);
    container.append(group);
  }

  // The text of a control on its canvas card (the owner's words; a switched-off checker is not named).
  // «Шаг после этапа»: the way to add a gate, a route or an owner step lives in the card of the stage it follows.
  const ADD_CONTROL_OPTIONS = [['', '— нет —'], ['gate', 'Проверка (gate)'], ['route', 'Маршрут (route)'], ['owner', 'Владелец (owner)']];
  function renderAddControl(container, { disabled = false, note = '', onAdd = null } = {}) {
    const doc = container.ownerDocument;
    const select = el(doc, 'select', 'stage-card-add-control');
    ADD_CONTROL_OPTIONS.forEach(([value, label]) => {
      const option = el(doc, 'option', '', label);
      option.value = value;
      select.append(option);
    });
    select.disabled = Boolean(disabled);
    select.setAttribute('aria-label', 'Добавить шаг после этапа');
    select.addEventListener('change', () => {
      const kind = select.value;
      select.value = '';
      if (kind && typeof onAdd === 'function') onAdd(kind);
    });
    const row = el(doc, 'label', 'stage-card-setting stage-card-add-control-row');
    row.append(doc.createTextNode('Шаг после этого этапа '), select);
    container.append(row);
    if (disabled && note) container.append(el(doc, 'p', 'stage-card-muted', note));
    return select;
  }

  function controlSummary(step = {}) {
    if (step.kind === 'gate') {
      const checkers = (Array.isArray(step.models) ? step.models : []).filter((model) => isPlain(model) && model.enabled !== false).map((model) => model.name);
      return `проверяют: ${checkers.length ? checkers.join(', ') : 'никто'}`;
    }
    if (step.kind === 'owner') return step.task ? `задание: ${String(step.task).split('\n')[0]}` : 'задание не задано';
    if (step.kind === 'route') {
      const by = isPlain(step.select) ? step.select.by : '';
      const count = isPlain(step.select) && Array.isArray(step.select.cases) ? step.select.cases.length : 0;
      const kind = { rule: 'по правилу', model: 'выбирает модель', owner: 'выбирает владелец' }[by] || 'вид не выбран';
      return `${kind}, вариантов: ${count}`;
    }
    return '';
  }

  const api = Object.freeze({ buildModel, render, renderStepFields, stepFieldsModel, stepsAfterToggle, outputAfterEdit, STATUS, feed,
    gateWindowModel, gateAfterEdit, renderGateWindow, controlSummary, transitionView, transitionAfterEdit,
    routeWindowModel, routeAfterEdit, renderRouteWindow, ownerWindowModel, ownerAfterEdit, renderOwnerWindow, renderAddControl });
  root.StageCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
