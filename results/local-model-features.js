// Button with the name of the local model in the header of the pipeline panel and its window of settings: modes and a checkbox
// for each function of the model. The registry and the choice live in LocalModel; changes are applied at once.
(function initLocalModelFeatures(root) {
  'use strict';

  const mount = (button, modal, api) => {
    if (!button || !modal || !api) return;
    const doc = button.ownerDocument;
    const title = modal.querySelector('.local-model-title');
    const modes = modal.querySelector('.local-model-modes');
    const list = modal.querySelector('.local-model-features');
    const closeButton = modal.querySelector('.local-model-close');
    const labelOf = (id) => (api.MODELS.find((item) => item.id === id) || {}).label || '';
    const isOpen = () => modal.style.display !== 'none' && modal.classList.contains('is-visible');
    const element = (tag, className, text) => {
      const node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };

    const renderModes = (model) => {
      modes.textContent = '';
      const current = api.presetOf(model);
      const own = new Set(api.FEATURES.map((item) => item.level));
      api.LEVELS.filter((level) => own.has(level.id)).forEach((level) => {
        const item = element('button', `local-model-mode${current === level.id ? ' is-active' : ''}`, level.label);
        item.type = 'button';
        item.dataset.level = level.id;
        item.addEventListener('click', () => { api.applyPreset(level.id, model); render(); });
        modes.append(item);
      });
      if (current === 'custom') modes.append(element('span', 'local-model-mode is-active is-custom', 'Свой'));
    };

    const renderFeatures = (model) => {
      list.textContent = '';
      const state = api.featureState(model);
      const groups = [];
      api.FEATURES.forEach((item) => {
        let group = groups.find((entry) => entry.name === item.group);
        if (!group) { group = { name: item.group, items: [] }; groups.push(group); }
        group.items.push(item);
      });
      groups.forEach((group) => {
        const section = element('div', 'local-model-group');
        section.append(element('div', 'local-model-group-title', group.name));
        group.items.forEach((item) => {
          const row = element('label', 'local-model-feature');
          const box = doc.createElement('input');
          box.type = 'checkbox';
          box.dataset.feature = item.id;
          box.checked = Boolean(state[item.id]);
          box.addEventListener('change', () => { api.setFeature(item.id, box.checked, model); render(); });
          row.append(box, element('span', '', item.label));
          section.append(row);
        });
        list.append(section);
      });
    };

    function render() {
      const model = api.modelChoice();
      const on = Boolean(model);
      button.hidden = !on;
      if (!on) { hide(); return; }
      button.textContent = labelOf(model);
      title.textContent = labelOf(model);
      renderModes(model);
      renderFeatures(model);
    }

    function show() {
      if (!api.modelChoice()) return;
      render();
      modal.style.display = 'flex';
      modal.classList.add('is-visible');
      modal.setAttribute('aria-hidden', 'false');
      doc.body.classList.add('modal-open');
    }
    function hide() {
      if (!isOpen() && modal.style.display === 'none') return;
      modal.style.display = 'none';
      modal.classList.remove('is-visible');
      modal.setAttribute('aria-hidden', 'true');
      if (!Array.from(doc.querySelectorAll('.modal')).some((item) => item.style.display !== 'none')) doc.body.classList.remove('modal-open');
    }

    button.addEventListener('click', show);
    closeButton?.addEventListener('click', hide);
    render();
    api.loadChoice().then(render);
    root.chrome?.storage?.onChanged?.addListener?.((changes, area) => {
      if (area === 'local' && (changes[api.CHOICE_KEY] || changes[api.FEATURES_KEY])) render();
    });
    // The list on the panel changes the model through setModel and the change event of its own select.
    doc.getElementById('local-model-select')?.addEventListener('change', render);
    return { render, show, hide };
  };

  const api = Object.freeze({ mount });
  root.LocalModelFeatures = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.LocalModel) {
    const doc = root.document;
    mount(doc.getElementById('local-model-button'), doc.getElementById('local-model-modal'), root.LocalModel);
  }
})(typeof window !== 'undefined' ? window : globalThis);
