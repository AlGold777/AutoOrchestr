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
  function buildModel({ round, templateStage = null, participants = [], stageRun = null } = {}) {
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

  const el = (documentRef, tag, className, text) => {
    const node = documentRef.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  function render(container, model, { onCopy = null } = {}) {
    const doc = container.ownerDocument;
    container.replaceChildren();
    if (model.subtitle) container.append(el(doc, 'p', 'stage-card-subtitle', model.subtitle));
    const meta = el(doc, 'div', 'stage-card-badges');
    model.badges.forEach((badge) => meta.append(el(doc, 'span', 'stage-card-badge', badge)));
    meta.append(el(doc, 'span', `stage-card-badge stage-card-status stage-card-status-${model.status.code}`, model.status.label));
    container.append(meta);

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
