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

  // The text of a control on its canvas card (the owner's words; a switched-off checker is not named).
  function controlSummary(step = {}) {
    if (step.kind === 'gate') {
      const checkers = (Array.isArray(step.models) ? step.models : []).filter((model) => isPlain(model) && model.enabled !== false).map((model) => model.name);
      return `проверяют: ${checkers.length ? checkers.join(', ') : 'никто'}`;
    }
    return '';
  }

  const api = Object.freeze({ buildModel, render, renderStepFields, stepFieldsModel, stepsAfterToggle, outputAfterEdit, STATUS, feed,
    gateWindowModel, gateAfterEdit, renderGateWindow, controlSummary, transitionView, transitionAfterEdit });
  root.StageCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
