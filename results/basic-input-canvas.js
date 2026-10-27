(function initBasicInputCanvas(root) {
  'use strict';

  const list = (value) => Array.isArray(value) ? value : [];
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  const idOf = (model) => text(model?.id) || text(model?.name);
  const syncByPanel = new WeakMap();
  const controlColumn = (panel, ref) => Array.from(panel.querySelectorAll('.pipeline-control-step[data-control-ref]'))
    .find((column) => column.dataset.controlRef === ref) || null;
  const controlCard = (column, ref) => Array.from(column?.querySelectorAll('[data-control-card]') || [])
    .find((card) => card.dataset.controlCard === ref) || null;

  const stepColumn = (panel, step) => {
    const round = /^r(\d+)$/.exec(step?.ref || '');
    if (round) return panel.querySelector(`.stage-column[data-round="${round[1]}"]:not(.pipeline-control-step)`);
    return controlColumn(panel, step?.ref || '');
  };

  const stepTarget = (panel, step, participant = '') => {
    const column = stepColumn(panel, step);
    if (!column) return null;
    if (step?.kind === 'owner') return controlCard(column, step.ref) || column;
    return participant ? modelBlock(column, participant) : column;
  };

  const modelBlock = (column, participant) => {
    const wanted = text(participant);
    if (!column || !wanted) return null;
    return Array.from(column.querySelectorAll('.model-block')).find((block) =>
      (block.dataset.participantId || block.dataset.providerName || block.dataset.model || block.querySelector('.model-name')?.textContent?.trim()) === wanted) || null;
  };

  function sync({ panel, schema, attachments = [], onFile } = {}) {
    if (!panel || typeof panel.querySelector !== 'function') return { chips: 0, links: 0 };
    const previous = syncByPanel.get(panel);
    if (previous) {
      if (previous.resize) panel.ownerDocument.defaultView?.removeEventListener('resize', previous.resize);
      if (previous.frame && panel.ownerDocument.defaultView?.cancelAnimationFrame) panel.ownerDocument.defaultView.cancelAnimationFrame(previous.frame);
    }
    panel.querySelectorAll('.basic-input-canvas-layer, .basic-input-canvas-chip, .basic-input-canvas-svg').forEach((node) => node.remove());
    const canvas = panel.querySelector('.pipeline-canvas') || panel;
    const steps = list(schema?.steps).filter(object);
    const byRef = new Map(steps.map((step) => [step.ref, step]));
    const position = new Map(steps.map((step, index) => [step.ref, index]));
    const chipByArtifact = new Map();
    let chipCount = 0;

    const makeChip = (host, { name, type = 'artifact', description = '', key = '', file = null } = {}) => {
      if (!host || !text(name)) return null;
      const chip = document.createElement(file && typeof onFile === 'function' ? 'button' : 'span');
      chip.className = `basic-input-canvas-chip is-${type}`;
      if (chip.tagName === 'BUTTON') chip.type = 'button';
      chip.textContent = text(name);
      chip.title = text(description) || text(name);
      chip.setAttribute('aria-label', `${type === 'file' ? 'Файл' : 'Артефакт'}: ${text(name)}`);
      if (key) chip.dataset.artifactKey = key;
      if (file) chip.dataset.fileId = text(file.id);
      if (file && typeof onFile === 'function') chip.addEventListener('click', () => onFile(file));
      host.appendChild(chip);
      chipCount += 1;
      return chip;
    };

    // Global attachments are displayed in In. They are not connected to steps unless the schema has an explicit source ref.
    const inColumn = panel.querySelector('.entry-column');
    list(attachments).forEach((attachment, index) => {
      const file = object(attachment) ? attachment : { name: String(attachment || '') };
      makeChip(inColumn, { name: file.name || file.filename, type: 'file', file: { ...file, id: file.id || `attachment-${index + 1}` } });
    });

    steps.forEach((step) => {
      const column = stepColumn(panel, step);
      if (!column) return;
      const stepFiles = list(step.files);
      stepFiles.forEach((file, index) => makeChip(column, { name: file?.name, type: 'file', file: { ...file, id: file?.id || `${step.ref}-file-${index + 1}` } }));
      const round = /^r\d+$/.test(step.ref || '');
      if (round) {
        list(step.models).forEach((model) => {
          const block = modelBlock(column, idOf(model));
          list(model?.files).forEach((file, index) => makeChip(block, { name: file?.name, type: 'file', file: { ...file, id: file?.id || `${step.ref}-${idOf(model)}-file-${index + 1}` } }));
        });
      }

      const declarations = [];
      if (step.kind === 'owner') {
        list(step.output?.artifacts).forEach((artifact) => declarations.push({ artifact, participant: 'owner', host: controlCard(column, step.ref) || column }));
      } else if (round) {
        list(step.models).forEach((model) => {
          if (model?.enabled === false) return;
          const participant = idOf(model);
          const ownOutput = object(model?.output) ? model.output : null;
          const output = ownOutput || step.output;
          list(output?.artifacts).forEach((artifact) => declarations.push({ artifact, participant, host: modelBlock(column, participant) || column }));
        });
      }
      declarations.forEach(({ artifact, participant, host }) => {
        if (!object(artifact) || !text(artifact.id)) return;
        const key = JSON.stringify([step.ref, participant, artifact.id]);
        const chip = makeChip(host, { name: artifact.name || artifact.id, description: artifact.description, key });
        if (chip) chipByArtifact.set(key, chip);
      });
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('basic-input-canvas-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.dataset.hidden = String(canvas.classList.contains('arrows-hidden'));
    canvas.appendChild(svg);
    const links = [];
    const addInputs = (consumer, sources, participant = '') => {
      const target = stepTarget(panel, consumer, participant);
      if (!target) return;
      list(sources).forEach((source) => {
        const sourceRef = typeof source === 'string' ? source : (source?.artifact?.step || source?.step);
        if (!byRef.has(sourceRef) || position.get(sourceRef) >= position.get(consumer.ref)) return;
        let sourceElement = null;
        if (typeof source === 'string') {
          const producer = byRef.get(source);
          if (producer) sourceElement = stepTarget(panel, producer);
        } else if (object(source) && object(source.artifact)) {
          const address = source.artifact;
          sourceElement = chipByArtifact.get(JSON.stringify([address.step, address.participant, address.id])) || null;
        } else if (object(source) && text(source.step)) {
          const producer = byRef.get(source.step);
          if (producer) sourceElement = stepTarget(panel, producer, source.participant || '');
        }
        if (sourceElement && sourceElement !== target) links.push({ source: sourceElement, target });
      });
    };
    steps.forEach((consumer) => {
      addInputs(consumer, consumer.input);
      if (/^r\d+$/.test(consumer.ref || '')) {
        list(consumer.models).forEach((model) => {
          if (model?.enabled !== false) addInputs(consumer, model.input, idOf(model));
        });
      }
    });

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const width = Math.max(canvas.scrollWidth || 0, bounds.width || 0, 1);
      const height = Math.max(canvas.scrollHeight || 0, bounds.height || 0, 1);
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      links.forEach(({ source, target }) => {
        const a = source.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const x1 = a.right - bounds.left + canvas.scrollLeft;
        const y1 = a.top + a.height / 2 - bounds.top + canvas.scrollTop;
        const x2 = b.left - bounds.left + canvas.scrollLeft;
        const y2 = b.top + b.height / 2 - bounds.top + canvas.scrollTop;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        const bend = Math.max(12, Math.abs(x2 - x1) * 0.35);
        path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`);
        path.setAttribute('class', 'basic-input-canvas-link');
        const endpointId = (element) => element.dataset.participantId || element.dataset.controlCard || element.dataset.controlRef
          || (element.dataset.round ? `r${element.dataset.round}` : '');
        path.dataset.source = endpointId(source);
        path.dataset.target = endpointId(target);
        svg.appendChild(path);
      });
    };
    draw();
    const view = panel.ownerDocument.defaultView;
    const resize = () => draw();
    view?.addEventListener('resize', resize);
    const state = { resize, frame: 0 };
    syncByPanel.set(panel, state);
    if (view?.requestAnimationFrame) state.frame = view.requestAnimationFrame(draw);
    return { chips: chipCount, links: links.length, redraw: draw };
  }

  const api = { sync };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BasicInputCanvas = api;
}(typeof window !== 'undefined' ? window : globalThis));
