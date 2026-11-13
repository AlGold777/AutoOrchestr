// List of the local model on the pipeline panel. Default: without LLM (Basic works on its own); the chosen model is kept by LocalModel.
(function initLocalModelSelect(root) {
  'use strict';

  const mount = (select, api) => {
    if (!select || !api) return;
    const doc = select.ownerDocument;
    api.MODELS.forEach((item) => {
      const option = doc.createElement('option');
      option.value = item.id;
      option.textContent = item.label;
      select.append(option);
    });
    const paint = () => select.classList.toggle('is-off', !select.value);
    select.addEventListener('change', () => { select.value = api.setModel(select.value); paint(); });
    const sync = () => { select.value = api.modelChoice(); paint(); };
    paint();
    api.loadChoice().then(sync);
    root.chrome?.storage?.onChanged?.addListener?.((changes, area) => { if (area === 'local' && changes[api.CHOICE_KEY]) sync(); });
  };

  const api = Object.freeze({ mount });
  root.LocalModelSelect = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root.document && root.LocalModel) mount(root.document.getElementById('local-model-select'), root.LocalModel);
})(typeof window !== 'undefined' ? window : globalThis);
