// Stage card: the dialog that opens on a round badge of the pipeline canvas.
// buildModel is pure (unit-tested); render writes it with textContent only.
(function initStageCard(root) {
  'use strict';

  const STATUS = {
    gate: 'Ворота: решает модератор',
    pending: 'Ожидает',
    running: 'Выполняется',
    awaiting_participant: 'Ответ участника',
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
  const participantLabel = (participant) => {
    const label = String(participant?.label || '').trim();
    const name = String(participant?.name || '').trim();
    const id = String(participant?.id || participant?.participantId || '').trim();
    const display = label || name;
    // Duplicate provider names are separate participants; show their stable key only
    // when the visible label alone cannot tell them apart.
    const duplicates = participant?.duplicateLabel;
    return display && duplicates && id ? `${display} · ${id.slice(0, 8)}` : display;
  };

  // round: canvas round number; templateStage: ArchitectureFramework stage or null;
  // participants: [{ name, send }] from the round's model stack; stageRun: the engine's
  // stage instance for this round (or null before / outside a run).
  // roleChoice (Custom rounds only): { prompts: [{ id, label }], roles: [prompt id or ''] per block,
  // disabled, roundPrompt } — one select for the whole round; mixed roles show 'разные' until chosen.
  // The round's text field shows only while 'custom' is selected.
  // roleChoice.settings (the round card of Basic): { input, task } the owner set ('' = not set, inherited),
  // inheritedTask (the text the round would take), first (the first round: nothing to feed in), disabled.
  // They give the input and the round's task.
  function buildModel({ round, templateStage = null, participants = [], stageRun = null, roleChoice = null } = {}) {
    const participantItems = participants.filter((item) => item && (item.name || item.label));
    const duplicateLabels = new Set();
    const labelCounts = new Map();
    participantItems.forEach((item) => {
      const key = String(item.label || item.name || '').trim();
      labelCounts.set(key, (labelCounts.get(key) || 0) + 1);
    });
    participantItems.forEach((item) => {
      const key = String(item.label || item.name || '').trim();
      if (labelCounts.get(key) > 1) duplicateLabels.add(item);
    });
    const showParticipant = (item) => participantLabel({ ...item, duplicateLabel: duplicateLabels.has(item) });
    const working = list(participantItems.filter((item) => item.send).map(showParticipant));
    const waiting = list(participantItems.filter((item) => !item.send).map(showParticipant));
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
          model.settings = settingsModel(roleChoice.settings, roleChoice);
          if (model.settings.owner.checked) model.badges.push('User: одобрение');
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

  const INPUT_LABELS = { none: 'Ничего', previous: 'Ответы последнего этапа с принятым результатом', all: 'Всё принятое за все предыдущие шаги' };
  const STEPS_LABEL = 'Выбранные этапы';
  const isPlain = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

  // The input «выбранные этапы» (4.3): the owner's list of step refs keeps its order; entries that are not step refs
  // (a participant, an artifact written in JSON) stay in place. Returns the new list for the step ref.
  function stepsAfterToggle(current, ref, checked) {
    const list = Array.isArray(current) ? current.slice() : [];
    const at = list.findIndex((item) => inputStepRef(item) === ref);
    if (checked && at < 0) list.push(ref);
    if (!checked && at >= 0) list.splice(at, 1);
    return list;
  }

  function inputStepRef(item) {
    if (typeof item === 'string') return item;
    if (isPlain(item) && typeof item.step === 'string' && !item.participant && !item.artifact && !item.revisionOf) return item.step;
    return '';
  }

  // Promote a selected string to a required whole-step source, or update an existing whole-step object in place.
  function stepRequiredAfterToggle(current, ref, required) {
    const next = Array.isArray(current) ? current.slice() : [];
    const at = next.findIndex((item) => inputStepRef(item) === ref);
    if (at < 0) return next;
    const item = next[at];
    if (typeof item === 'string') {
      if (required) next[at] = { step: ref, required: true };
    } else {
      next[at] = { ...item, required: Boolean(required) };
    }
    return next;
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

  // The fields of a step the card shows after the task: owner, output.
  function stepRestModel(settings = {}) {
    const output = isPlain(settings.output) ? settings.output : {};
    return {
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

  // The input of a round: `first` (the first round has nothing to feed in) gives null. An array of refs or a drafted
  // «steps» shows the choice «выбранные этапы» with the earlier steps.
  function stepInputModel(settings = {}, { first = false, earlier = [], drafts = {} } = {}) {
    if (first) return null;
    const input = Array.isArray(settings.input) ? settings.input : String(settings.input || '');
    const picked = Array.isArray(input) ? input : [];
    const defaultInput = 'previous';
    const stepsMode = Array.isArray(input) || input === 'steps' || drafts.input === 'steps';
    const options = [
      { value: '', label: `По умолчанию (${INPUT_LABELS[defaultInput].toLowerCase()})` },
      ...Object.entries(INPUT_LABELS).map(([value, label]) => ({ value, label })),
      { value: 'steps', label: STEPS_LABEL }
    ];
    return {
      value: stepsMode ? 'steps' : input,
      options,
      steps: earlier.map((item) => {
        const at = picked.findIndex((source) => inputStepRef(source) === item.ref);
        const source = at >= 0 ? picked[at] : null;
        return { ref: item.ref, label: item.label, disabled: !item.enabled, checked: at >= 0,
          required: isPlain(source) && source.required === true, number: at >= 0 ? at + 1 : 0 };
      }),
      objectRefs: picked.filter((source) => !inputStepRef(source)).length
    };
  }

  // The input and the task of a round card; `first` and `inheritedTask` as before. The input of a later round
  // is the previous step by default, the first round has no input (null). A draft is a choice the owner made in the card
  // that the schema does not hold yet («выбранные этапы» without a step).
  function settingsModel(settings, { first = false, inheritedTask = '', disabled = false, earlier = [], drafts = {} } = {}) {
    const input = stepInputModel(settings, { first, earlier, drafts });
    const stepsMode = input?.value === 'steps';
    const defaultInput = first ? 'none' : 'previous';
    const effectiveInput = stepsMode ? 'steps' : (input?.value || defaultInput);
    return {
      disabled: Boolean(disabled),
      input,
      // The task is always shown. With the input nothing only the task written here is sent (the shared one is not), so the
      // placeholder of the shared task stays empty and the label says so. «выбранные этапы» sends the step's answers, so the task goes.
      task: { value: String(settings.task || ''), placeholder: effectiveInput === 'none' ? '' : String(inheritedTask || ''), sent: effectiveInput !== 'none' },
      ...stepRestModel(settings)
    };
  }

  // A select row of a card (input): the choice goes to emit(field, value).
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

  // The list of steps of the input «выбранные этапы». The page keeps the source order.
  // The number is the place of the step in the owner's list; a switched-off step is marked, not hidden.
  function renderSteps(container, input, emit, disabled = false) {
    const doc = container.ownerDocument;
    const box = el(doc, 'fieldset', 'stage-card-steps');
    box.append(el(doc, 'legend', '', 'Этапы для входа (номер — порядок выбора)'),
      el(doc, 'p', 'stage-card-muted', 'Вход «Ответы последнего этапа с принятым результатом» пропускает этапы без ответа. Здесь можно выбрать этапы явно и сделать каждый обязательным: без результата прогон остановится.'));
    if (!input.steps.length) box.append(el(doc, 'p', 'stage-card-muted', 'Раньше этих шагов нет.'));
    input.steps.forEach((item) => {
      const row = el(doc, 'div', 'stage-card-step-option');
      const check = el(doc, 'input');
      check.type = 'checkbox';
      check.checked = item.checked;
      check.disabled = Boolean(disabled);
      check.addEventListener('change', () => emit('steps', { ref: item.ref, checked: check.checked }));
      const selectLabel = el(doc, 'label');
      selectLabel.append(check, doc.createTextNode(` ${item.label}${item.disabled ? ' (выключен)' : ''}${item.number ? ` · ${item.number}` : ''}`));
      row.append(selectLabel);
      if (item.checked) {
        const required = el(doc, 'input', 'stage-card-step-required');
        required.type = 'checkbox';
        required.checked = item.required;
        required.disabled = Boolean(disabled);
        required.setAttribute('aria-label', `Обязательный этап: ${item.label}`);
        required.addEventListener('change', () => emit('stepRequired', { ref: item.ref, required: required.checked }));
        const requiredLabel = el(doc, 'label', 'stage-card-step-required-label');
        requiredLabel.append(required, doc.createTextNode(' Обязательный'));
        row.append(requiredLabel);
      }
      box.append(row);
    });
    if (input.objectRefs) box.append(el(doc, 'p', 'stage-card-muted', `Ссылки на участников и артефакты (${input.objectRefs}) заданы в JSON и сохраняются.`));
    container.append(box);
  }

  // The fields after the task: the owner's approval, the output of the step.
  function renderRest(container, fields, emit) {
    const doc = container.ownerDocument;
    const disabled = Boolean(fields.disabled);
    const ownerBox = el(doc, 'input', 'stage-card-owner-check');
    ownerBox.type = 'checkbox';
    ownerBox.checked = fields.owner.checked;
    ownerBox.disabled = disabled;
    ownerBox.addEventListener('change', () => emit('owner', ownerBox.checked ? 'approve' : ''));
    const ownerWrap = el(doc, 'label', 'stage-card-setting stage-card-owner');
    ownerWrap.append(ownerBox, doc.createTextNode(' Спросить User после этапа'));
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
  const feed = Object.freeze({
    // The label of an answer card: the step, the participant (when it is not the model) and the visit (from the second).
    role({ label = '', modelName = '', participantId = '', visit = 1 } = {}) {
      const parts = [`Basic · ${label}`];
      if (participantId && participantId !== modelName) parts.push(`участник ${participantId}`);
      if (Number(visit) > 1) parts.push(`заход ${visit}`);
      return parts.join(' · ');
    },
    // The title of an artifact in the registry: name, participant (owner for an owner step), visit, validity.
    artifactTitle({ name = '', source = {}, valid = true } = {}) {
      const author = source.participant === 'owner' ? 'User' : `участник ${source.participant}`;
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

  // The window of an owner (6.1 of the spec, 8.1): the task the owner has to provide and the output of the step (as the round
  // windows have it). The input of an owner is not edited here; it stays as the schema has it.
  function ownerWindowModel(step = {}, { disabled = false, documentSources = [] } = {}) {
    const output = isPlain(step.output) ? step.output : {};
    return {
      ref: String(step.ref || ''),
      disabled: Boolean(disabled),
      goal: typeof step.goal === 'string' ? step.goal : '',
      task: typeof step.task === 'string' ? step.task : '',
      document: {
        value: typeof step.document === 'string' ? step.document : '',
        sources: documentSources.map(({ ref, label, declared }) => ({ ref: String(ref), label: String(label), declared: declared === true }))
      },
      output: {
        name: String(output.name || ''),
        form: String(output.form || ''),
        sections: Array.isArray(output.sections) ? output.sections.map(String).join('\n') : '',
        strictLength: output.strictLength === true,
        json: output.format === 'json'
      }
    };
  }
  // An edit of an owner: { field: 'goal', value } | { field: 'task', value } | { field: 'output', value: { name, form, sections (lines), strictLength } }.
  function ownerAfterEdit(step = {}, edit = {}) {
    const next = { ...step };
    if (edit.field === 'goal') {
      if (String(edit.value || '').trim()) next.goal = String(edit.value);
      else delete next.goal;
    } else if (edit.field === 'task') {
      if (String(edit.value || '').trim()) next.task = String(edit.value);
      else delete next.task;
    } else if (edit.field === 'document') {
      if (String(edit.value || '').trim()) next.document = String(edit.value).trim();
      else delete next.document;
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
    const goal = el(doc, 'textarea', 'stage-card-owner-goal');
    goal.rows = 2; goal.value = model.goal; goal.disabled = disabled; goal.spellcheck = false;
    goal.setAttribute('aria-label', 'Назначение этапа');
    goal.addEventListener('change', () => send({ field: 'goal', value: goal.value }));
    const goalWrap = el(doc, 'label', 'stage-card-setting stage-card-owner-goal-label');
    goalWrap.append(doc.createTextNode('Назначение этапа '), goal);
    container.append(goalWrap);
    container.append(el(doc, 'p', 'stage-card-muted', 'Для чего этот этап и что человек должен сделать — видит User в окне вопроса'));
    const task = el(doc, 'textarea', 'stage-card-owner-task');
    task.rows = 4; task.value = model.task; task.disabled = disabled; task.spellcheck = false;
    task.setAttribute('aria-label', 'Что должен предоставить User');
    task.addEventListener('change', () => send({ field: 'task', value: task.value }));
    const taskWrap = el(doc, 'label', 'stage-card-setting stage-card-owner-task-label');
    taskWrap.append(doc.createTextNode('Что должен предоставить User '), task);
    container.append(taskWrap);

    const documentSelect = el(doc, 'select', 'stage-card-owner-document');
    const noneOption = el(doc, 'option', '', 'нет');
    noneOption.value = '';
    documentSelect.append(noneOption);
    model.document.sources.forEach((source) => {
      const option = el(doc, 'option', '', source.label);
      option.value = source.ref;
      documentSelect.append(option);
    });
    if (model.document.value && !model.document.sources.some((source) => source.ref === model.document.value)) {
      const missing = el(doc, 'option', '', `${model.document.value} (недоступен)`);
      missing.value = model.document.value;
      documentSelect.append(missing);
    }
    documentSelect.value = model.document.value;
    documentSelect.disabled = Boolean(model.disabled);
    documentSelect.setAttribute('aria-label', 'Документ для User');
    documentSelect.addEventListener('change', () => send({ field: 'document', value: documentSelect.value }));
    const documentWrap = el(doc, 'label', 'stage-card-setting stage-card-owner-document-label');
    documentWrap.append(doc.createTextNode('Документ для User '), documentSelect);
    container.append(documentWrap);
    container.append(el(doc, 'p', 'stage-card-muted', 'Раунд выше с одной моделью. Вид документа задаёт output.document раунда: read — для чтения, form — опросник.'));

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

  // «Шаг после этапа»: the way to add an owner step lives in the card of the stage it follows.
  const ADD_CONTROL_OPTIONS = [['', '— нет —'], ['owner', 'User (owner)']];
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

  // The text of the owner window (N07): the task, what the owner was given (the input items of the engine) and the form of
  // the answer that is expected. A file item shows its name only: the page does not open files yet.
  const OWNER_ITEM_LIMIT = 6000;
  function ownerAskMessage({ task = '', goal = '', input = [], output = null, reason = '', detail = '', reasonText = '' } = {}) {
    const parts = [goal ? `Назначение: ${String(goal)}` : '', String(task || '')];
    const items = Array.isArray(input) ? input : [];
    if (items.length) {
      parts.push('Вам передано:');
      items.forEach((item) => {
        const label = item.label || [item.step, item.participant].filter(Boolean).join(' / ') || 'источник';
        let body;
        if (item.file) body = `[файл${item.file.name ? ` «${item.file.name}»` : ''}]`;
        else {
          const text = String(item.text ?? '');
          body = text.length > OWNER_ITEM_LIMIT ? `${text.slice(0, OWNER_ITEM_LIMIT)}\n… (показано ${OWNER_ITEM_LIMIT} из ${text.length} символов)` : text;
        }
        parts.push(`— ${label}:\n${body}`);
      });
    }
    if (isPlain(output) && (output.name || output.form)) {
      parts.push(`Ожидается: ${[output.name, output.form].filter(Boolean).join(' — ')}`);
    }
    if (reason) parts.push(`Прошлый ответ не принят: ${reasonText || reason}${detail ? ` (${detail})` : ''}.`);
    return parts.filter(Boolean).join('\n');
  }

  // The text of an owner step on its canvas card (the owner's words).
  function controlSummary(step = {}) {
    if (step.kind === 'owner') return step.task ? String(step.task).split('\n')[0] : 'задание не задано';
    return '';
  }

  const api = Object.freeze({ buildModel, render, stepsAfterToggle, stepRequiredAfterToggle, outputAfterEdit, STATUS, feed,
    controlSummary, ownerWindowModel, ownerAfterEdit, renderOwnerWindow, renderAddControl, ownerAskMessage });
  root.StageCard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
