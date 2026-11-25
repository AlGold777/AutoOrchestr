(function initBasicInputCanvas(root) {
  'use strict';

  const list = (value) => Array.isArray(value) ? value : [];
  const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
  const text = (value) => typeof value === 'string' ? value.trim() : '';
  const idOf = (model) => text(model?.id) || text(model?.name);
  const syncByPanel = new WeakMap();
  let nextMarkerId = 0;
  const controlColumn = (panel, ref) => Array.from(panel.querySelectorAll('.pipeline-control-step[data-control-ref]'))
    .find((column) => column.dataset.controlRef === ref) || null;

  const stepColumn = (panel, step) => {
    const round = /^r(\d+)$/.exec(step?.ref || '');
    if (round) return panel.querySelector(`.stage-column[data-round="${round[1]}"]:not(.pipeline-control-step)`);
    return controlColumn(panel, step?.ref || '');
  };

  const stepJunction = (panel, step) => {
    const column = stepColumn(panel, step);
    if (!column) return null;
    const incoming = column.previousElementSibling;
    return incoming?.matches('.connector-group') ? incoming.querySelector('[data-artifact-junction]') : null;
  };

  const modelBlock = (column, participant) => {
    const wanted = text(participant);
    if (!column || !wanted) return null;
    return Array.from(column.querySelectorAll('.model-block')).find((block) =>
      (block.dataset.participantId || block.dataset.providerName || block.dataset.model || block.querySelector('.model-name')?.textContent?.trim()) === wanted) || null;
  };

  function sync({ panel, schema, attachments = [], onFile, onRemoveFile } = {}) {
    if (!panel || typeof panel.querySelector !== 'function') return { chips: 0, links: 0 };
    const previous = syncByPanel.get(panel);
    if (previous) {
      previous.cleanup?.();
      if (previous.resize) panel.ownerDocument.defaultView?.removeEventListener('resize', previous.resize);
      if (previous.frame && panel.ownerDocument.defaultView?.cancelAnimationFrame) panel.ownerDocument.defaultView.cancelAnimationFrame(previous.frame);
    }
    // Keep document buttons and their handlers when only attachments are refreshed.
    panel.querySelectorAll('.basic-input-canvas-layer .pipeline-doc-frame').forEach((frame) => frame.closest('.stage-column')?.appendChild(frame));
    panel.querySelectorAll('.basic-input-canvas-layer, .basic-input-file-wrap, .basic-input-canvas-chip, .basic-input-canvas-svg').forEach((node) => node.remove());
    const canvas = panel.querySelector('.pipeline-canvas') || panel;
    const steps = list(schema?.steps).filter(object);
    const byRef = new Map(steps.map((step) => [step.ref, step]));
    const position = new Map(steps.map((step, index) => [step.ref, index]));
    const chipByArtifact = new Map();
    const artifactSources = [];
    const rows = new Map();
    const usedDocumentFrames = new Set();
    let chipCount = 0;
    const cleanups = [];
    let editingFile = null;

    const artifactRow = (column) => {
      if (!column) return null;
      if (!rows.has(column)) {
        const row = panel.ownerDocument.createElement('div');
        row.className = 'basic-input-canvas-layer';
        column.appendChild(row);
        rows.set(column, row);
      }
      return rows.get(column);
    };

    const makeChip = (host, { name, type = 'artifact', description = '', key = '', file = null, scope = null } = {}) => {
      if (!host || !text(name)) return null;
      const chip = document.createElement(file && scope && typeof onFile === 'function' ? 'button' : 'span');
      chip.className = `basic-input-canvas-chip is-${type}`;
      if (chip.tagName === 'BUTTON') chip.type = 'button';
      chip.textContent = text(name);
      chip.title = text(description) || text(name);
      chip.setAttribute('aria-label', `${type === 'file' ? 'Файл' : 'Артефакт'}: ${text(name)}`);
      if (key) chip.dataset.artifactKey = key;
      if (file) chip.dataset.fileId = text(file.id);
      if (file && scope && typeof onFile === 'function') {
        let suppressClick = false;
        let press = null;
        const cancel = () => { if (press) clearTimeout(press.timer); press = null; };
        const wrapper = document.createElement('span');
        wrapper.className = 'basic-input-file-wrap';
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'basic-input-file-delete'; remove.textContent = '×';
        remove.setAttribute('aria-label', `Удалить файл: ${text(name)}`);
        remove.hidden = true;
        wrapper.append(chip, remove);
        const hide = () => { remove.hidden = true; if (editingFile === hide) editingFile = null; };
        const down = (event) => {
          event.stopPropagation();
          if (event.button !== 0 || typeof onRemoveFile !== 'function') return;
          cancel(); suppressClick = false;
          const current = { x: event.clientX, y: event.clientY, id: event.pointerId, timer: null };
          current.timer = setTimeout(() => {
            if (!wrapper.isConnected || press !== current) return;
            if (editingFile) editingFile();
            editingFile = hide; remove.hidden = false; suppressClick = true;
          }, 550);
          press = current;
        };
        const move = (event) => { if (press && (event.pointerId !== press.id || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 8)) cancel(); };
        const outside = (event) => { if (!wrapper.contains(event.target)) hide(); };
        const escape = (event) => { if (event.key === 'Escape') { cancel(); hide(); } };
        chip.addEventListener('pointerdown', down);
        chip.addEventListener('dragstart', cancel);
        chip.addEventListener('click', (event) => { event.stopPropagation(); if (suppressClick) { suppressClick = false; return; } onFile(file, scope); });
        remove.addEventListener('click', (event) => { event.stopPropagation(); hide(); onRemoveFile?.(file, scope); });
        const doc = panel.ownerDocument;
        doc.addEventListener('pointermove', move); doc.addEventListener('pointerup', cancel); doc.addEventListener('pointercancel', cancel);
        doc.addEventListener('pointerdown', outside, true); doc.addEventListener('keydown', escape);
        cleanups.push(() => { cancel(); doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', cancel);
          doc.removeEventListener('pointercancel', cancel); doc.removeEventListener('pointerdown', outside, true); doc.removeEventListener('keydown', escape); });
        host.appendChild(wrapper);
      } else host.appendChild(chip);
      chipCount += 1;
      return chip;
    };

    // Global attachments are displayed in In. They are not connected to steps unless the schema has an explicit source ref.
    const inColumn = panel.querySelector('.entry-column');
    list(attachments).forEach((attachment, index) => {
      const file = object(attachment) ? attachment : { name: String(attachment || '') };
      makeChip(artifactRow(inColumn), { name: file.name || file.filename, type: 'file', file: { ...file, id: file.id || `attachment-${index + 1}` },
        scope: file.key ? { ref: 'in' } : null });
    });

    steps.forEach((step) => {
      const column = stepColumn(panel, step);
      if (!column) return;
      const stepFiles = list(step.files);
      stepFiles.forEach((file, index) => makeChip(artifactRow(column), { name: file?.name, type: 'file', file: { ...file, id: file?.id || `${step.ref}-file-${index + 1}` }, scope: { ref: step.ref } }));
      const round = /^r\d+$/.test(step.ref || '');
      if (round) {
        list(step.models).forEach((model) => {
          const block = modelBlock(column, idOf(model));
          list(model?.files).forEach((file, index) => makeChip(block, { name: file?.name, type: 'file', file: { ...file, id: file?.id || `${step.ref}-${idOf(model)}-file-${index + 1}` }, scope: { ref: step.ref, participant: idOf(model) } }));
        });
      }

      const declarations = [];
      if (step.kind === 'owner') {
        list(step.output?.artifacts).forEach((artifact) => declarations.push({ artifact, participant: 'owner' }));
      } else if (round) {
        list(step.models).forEach((model) => {
          if (model?.enabled === false) return;
          const participant = idOf(model);
          const ownOutput = object(model?.output) ? model.output : null;
          const output = ownOutput || step.output;
          list(output?.artifacts).forEach((artifact) => declarations.push({ artifact, participant }));
        });
      }
      declarations.forEach(({ artifact, participant }) => {
        if (!object(artifact) || !text(artifact.id)) return;
        const key = JSON.stringify([step.ref, participant, artifact.id]);
        const host = artifactRow(column);
        const frame = Array.from(column.querySelectorAll('.pipeline-doc-frame'))
          .find((item) => item.dataset.docId === artifact.id && item.dataset.docParticipant === participant && !usedDocumentFrames.has(item));
        let chip;
        if (frame) {
          usedDocumentFrames.add(frame);
          frame.dataset.artifactKey = key;
          host.appendChild(frame);
          Array.from(column.querySelectorAll('.pipeline-doc-frame')).filter((item) => item.dataset.docId === artifact.id && item.dataset.docParticipant === participant && !usedDocumentFrames.has(item)).forEach((item) => {
            usedDocumentFrames.add(item);
            host.appendChild(item);
            chipCount += 1;
          });
          chip = frame;
          chipCount += 1;
        } else {
          chip = makeChip(host, { name: artifact.name || artifact.id, description: artifact.description, key });
        }
        if (chip) {
          chipByArtifact.set(key, chip);
          artifactSources.push({ ref: step.ref, participant, key, element: chip });
        }
      });
    });

    // Versions made by User have no output declaration of their own, but remain visible in that step.
    panel.querySelectorAll('.pipeline-doc-frame').forEach((frame) => {
      if (!usedDocumentFrames.has(frame)) artifactRow(frame.closest('.stage-column'))?.appendChild(frame);
    });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('basic-input-canvas-svg');
    svg.setAttribute('aria-hidden', 'true');
    svg.dataset.hidden = String(canvas.classList.contains('arrows-hidden'));
    canvas.appendChild(svg);
    const links = [];
    const seenLinks = new Set();
    const markerId = `basic-input-arrow-${++nextMarkerId}`;
    const addInputs = (consumer, sources) => {
      const target = stepJunction(panel, consumer);
      if (!target) return;
      list(sources).forEach((source) => {
        const sourceRef = typeof source === 'string' ? source : (source?.artifact?.step || source?.step);
        if (!byRef.has(sourceRef) || position.get(sourceRef) >= position.get(consumer.ref)) return;
        let producers;
        if (object(source) && object(source.artifact)) {
          const address = source.artifact;
          const key = JSON.stringify([address.step, address.participant, address.id]);
          producers = chipByArtifact.has(key) ? artifactSources.filter((item) => item.key === key) : [];
        } else {
          const wanted = object(source) ? text(source.participant) : '';
          producers = artifactSources.filter((item) => item.ref === sourceRef && (!wanted || item.participant === wanted));
        }
        producers.forEach((producer) => {
          const key = JSON.stringify([producer.key, consumer.ref]);
          if (seenLinks.has(key)) return;
          seenLinks.add(key);
          links.push({ source: producer.element, target, artifact: producer, targetRef: consumer.ref });
        });
      });
    };
    steps.forEach((consumer) => {
      if (/^r\d+$/.test(consumer.ref || '')) {
        list(consumer.models).forEach((model) => {
          if (model?.enabled !== false) addInputs(consumer, model.input === undefined ? consumer.input : model.input);
        });
      } else addInputs(consumer, consumer.input);
    });

    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      const pointX = (x) => x - bounds.left + canvas.scrollLeft;
      const pointY = (y) => y - bounds.top + canvas.scrollTop;
      const flow = canvas.querySelector('.pipeline-flow') || canvas;
      const flowBounds = flow.getBoundingClientRect();
      const routes = links.filter(({ source, target }) => source.isConnected && target.isConnected);
      const obstacles = Array.from(canvas.querySelectorAll('.basic-input-canvas-layer > *'), (element) => ({ element, rect: element.getBoundingClientRect() }));
      const width = Math.max(bounds.width || 0, pointX(flowBounds.right) + 16, 1);
      const height = Math.max(bounds.height || 0, pointY(flowBounds.bottom) + 10, 1);
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      while (svg.firstChild) svg.removeChild(svg.firstChild);
      const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
      marker.id = markerId;
      marker.setAttribute('viewBox', '0 0 8 8');
      marker.setAttribute('refX', '8');
      marker.setAttribute('refY', '4');
      marker.setAttribute('markerWidth', '5');
      marker.setAttribute('markerHeight', '5');
      marker.setAttribute('orient', 'auto');
      const head = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
      head.setAttribute('points', '0,0 8,4 0,8');
      head.setAttribute('fill', '#94a3b8');
      marker.appendChild(head);
      defs.appendChild(marker);
      svg.appendChild(defs);
      routes.forEach(({ source, target, artifact, targetRef }) => {
        const a = source.getBoundingClientRect();
        const b = target.getBoundingClientRect();
        const x1 = pointX(a.right);
        const y1 = pointY(a.top + a.height / 2);
        const x2 = pointX(b.left + b.width / 2);
        const y2 = pointY(b.top + b.height / 2);
        // Keep the horizontal route at the artifact's center, taking any intervening artifacts from above.
        const bypasses = obstacles.filter(({ element, rect }) => element !== source && rect.width > 0 && rect.height > 0
          && pointX(rect.right) > x1 && pointX(rect.left) < x2
          && pointY(rect.top) <= y1 && pointY(rect.bottom) >= y1)
          .map(({ rect }) => ({ left: Math.max(x1, pointX(rect.left) - 2), right: Math.min(x2, pointX(rect.right) + 2), top: pointY(rect.top) - 6 }))
          .sort((left, right) => left.left - right.left);
        const spans = [];
        bypasses.forEach((span) => {
          const previous = spans[spans.length - 1];
          if (previous && span.left <= previous.right) {
            previous.right = Math.max(previous.right, span.right);
            previous.top = Math.min(previous.top, span.top);
          } else spans.push({ ...span });
        });
        let route = `M ${x1} ${y1}`;
        spans.forEach((span) => { route += ` H ${span.left} V ${span.top} H ${span.right} V ${y1}`; });
        route += ` H ${x2} V ${y2}`;
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', route);
        path.setAttribute('class', 'basic-input-canvas-link');
        path.setAttribute('marker-end', `url(#${markerId})`);
        path.dataset.source = artifact.participant === 'owner' ? artifact.ref : artifact.participant;
        path.dataset.sourceArtifact = artifact.key;
        path.dataset.target = targetRef;
        svg.appendChild(path);
      });
    };
    draw();
    const view = panel.ownerDocument.defaultView;
    const resize = () => draw();
    view?.addEventListener('resize', resize);
    const state = { resize, frame: 0, cleanup: () => cleanups.forEach((fn) => fn()) };
    syncByPanel.set(panel, state);
    if (view?.requestAnimationFrame) state.frame = view.requestAnimationFrame(draw);
    return { chips: chipCount, links: links.length, redraw: draw };
  }

  const api = { sync };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BasicInputCanvas = api;
}(typeof window !== 'undefined' ? window : globalThis));
