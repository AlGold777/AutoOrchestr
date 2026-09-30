const StateMap = require('../disput/debate-state-map');

const legacyMarkup = () => `
<section id="disput-state-map-panel" data-status="not_ready">
  <button data-map-collapse aria-expanded="false"><span><strong data-map-title>Карта состояния</strong><small data-map-summary>legacy</small></span></button>
  <div class="disput-state-map-workspace" hidden>
    <header>
      <select data-map-run><option value="">Текущее дело</option></select>
      <div class="disput-state-map-actions">
        <button data-map-mode="structure">Структура</button>
        <button data-map-mode="graf">Graf</button>
        <button data-map-mode="history">История</button>
        <button data-case-export><i class="ti ti-folder"></i></button>
        <button data-map-export><i class="ti ti-download"></i></button>
        <button data-case-import-action><i class="ti ti-upload"></i></button>
        <button data-case-delete><i class="ti ti-trash"></i></button>
        <button data-map-close>×</button>
      </div>
    </header>
    <div class="disput-state-map-toolbar">
      <button data-map-filter="all">Все</button>
      <input data-map-search>
      <button data-map-compare>Сравнить</button>
      <button data-map-zoom="reset">100%</button>
    </div>
    <div data-map-content>legacy content</div>
    <aside data-map-drawer></aside>
  </div>
</section>`;

describe('Disput state map shell view', () => {
  const aggregate = {
    runId: 'run-ui',
    status: 'running',
    config: { topic: 'UI case' },
    executionPlan: { profileId: 'UNIVERSAL_STANDARD' },
    protocolState: { registry: { artifacts: {} } }
  };

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = legacyMarkup();
    window.DebateStateMap = StateMap;
    if (!window.URL.createObjectURL) window.URL.createObjectURL = jest.fn(() => 'blob:test');
    if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = jest.fn();
    require('../results/disput-state-map-view');
  });

  test('prunes every legacy state-map control and leaves only title plus five actions', () => {
    window.DisputStateMapView.init({ aggregate });

    const panel = document.getElementById('disput-state-map-panel');
    expect(panel.dataset.mapShell).toBe('true');
    expect(panel.textContent).toContain('Карта состояния');

    [
      '[data-map-mode]',
      '[data-map-filter]',
      '[data-map-search]',
      '[data-map-run]',
      '[data-map-compare]',
      '[data-map-zoom]',
      '[data-map-content]',
      '[data-map-drawer]',
      '[data-map-summary]'
    ].forEach((selector) => expect(panel.querySelector(selector)).toBeNull());

    const actions = panel.querySelector('.disput-state-map-actions');
    expect(actions).not.toBeNull();
    expect(actions.querySelectorAll('button')).toHaveLength(5);
    expect(actions.querySelector('[data-case-export]')).not.toBeNull();
    expect(actions.querySelector('[data-map-export]')).not.toBeNull();
    expect(actions.querySelector('[data-case-import-action]')).not.toBeNull();
    expect(actions.querySelector('[data-case-delete]')).not.toBeNull();
    expect(actions.querySelector('[data-map-close]')).not.toBeNull();
  });

  test('opens and closes the compact header-only workspace', () => {
    const view = window.DisputStateMapView.init({ aggregate });
    const workspace = document.querySelector('.disput-state-map-workspace');
    expect(workspace.hidden).toBe(true);

    view.open();
    expect(workspace.hidden).toBe(false);
    expect(workspace.querySelector('.disput-state-map-header')).not.toBeNull();
    expect(workspace.querySelector('.disput-state-map-toolbar')).toBeNull();

    view.close();
    expect(workspace.hidden).toBe(true);
  });

  test('keeps case import and delete actions wired', async () => {
    const remove = jest.fn(() => Promise.resolve());
    const importCase = jest.fn(() => Promise.resolve(aggregate));
    const caseStore = {
      list: jest.fn(() => Promise.resolve([])),
      subscribe: jest.fn(),
      getState: jest.fn(() => ({ caseId: 'case-1' })),
      remove,
      importCase
    };
    window.DisputStateMapView.init({ aggregate, caseStore });

    document.querySelector('[data-case-delete]').click();
    await Promise.resolve();
    expect(remove).toHaveBeenCalledWith('case-1');

    const input = document.querySelector('[data-case-import]');
    Object.defineProperty(input, 'files', { configurable: true, value: [{ text: async () => JSON.stringify(aggregate) }] });
    input.dispatchEvent(new Event('change'));
    await Promise.resolve();
    await Promise.resolve();
    expect(importCase).toHaveBeenCalled();
  });

  test('render updates the projected map without recreating removed UI', () => {
    const view = window.DisputStateMapView.init({ aggregate });
    view.render({ ...aggregate, status: 'paused' });
    expect(view.getMap().technicalStatus).toBe('paused');
    expect(document.querySelector('[data-map-content]')).toBeNull();
    expect(document.querySelectorAll('.disput-state-map-actions button')).toHaveLength(5);
  });
});
