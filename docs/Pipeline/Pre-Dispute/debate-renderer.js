// DOM adapter for Debate view models.
(function initDebateRenderer(root) {
  'use strict';

  function renderRunControls({ runButton, stepButton, view }) {
    if (!view) return;
    if (runButton) {
      runButton.replaceChildren();
      const icon = runButton.ownerDocument.createElement('i');
      icon.className = view.icon;
      icon.setAttribute('aria-hidden', 'true');
      runButton.appendChild(icon);
      runButton.title = view.title;
      runButton.setAttribute('aria-label', view.title);
      runButton.disabled = view.enabled !== true;
      runButton.setAttribute('aria-disabled', String(view.enabled !== true));
      runButton.classList.toggle('is-active', view.active === true);
      runButton.dataset.action = view.action;
    }
    if (stepButton) {
      stepButton.disabled = view.stepEnabled !== true;
      stepButton.textContent = view.stepEnabled ? 'Approve' : 'Step';
    }
  }

  function setVisible(element, visible) {
    if (!element) return;
    element.hidden = !visible;
    element.setAttribute('aria-hidden', String(!visible));
  }

  const api = Object.freeze({ renderRunControls, setVisible });
  root.DebateRenderer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
