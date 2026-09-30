const StateMap = require('../disput/debate-state-map');

const markup = () => `<section id="disput-state-map-panel"><button data-map-collapse aria-expanded="false"><span><strong data-map-title></strong><small data-map-summary></small></span></button><div class="disput-state-map-workspace" hidden><header><span data-map-summary></span><button data-map-mode="structure"></button><button data-map-mode="graf"></button><button data-map-export></button><button data-map-close></button><select data-map-run><option value=""></option></select></header><div><button data-map-filter="all"></button><button data-map-filter="open"></button><button data-map-filter="blocking"></button><button data-map-filter="dissent"></button><input data-map-search><button data-map-zoom="out"></button><button data-map-zoom="reset"></button><button data-map-zoom="in"></button></div><div data-map-content></div><aside data-map-drawer hidden></aside></div></section>`;

describe('Disput state map view', () => {
  beforeEach(() => {
    jest.resetModules(); document.body.className = ''; document.body.innerHTML = markup();
    window.DebateStateMap = StateMap;
    window.requestAnimationFrame = (callback) => { callback(); return 1; };
    global.requestAnimationFrame = window.requestAnimationFrame;
    if (!window.CSS) window.CSS = {}; if (!window.CSS.escape) window.CSS.escape = (value) => String(value).replace(/"/g, '\\"');
    require('../results/disput-state-map-view');
  });

  const aggregate = {
    runId: 'run-ui', status: 'running', config: { topic: 'UI case' }, executionPlan: { profileId: 'UNIVERSAL_STANDARD' },
    protocolState: { registry: { artifacts: {
      c1: { id: 'c1', type: 'claim', status: 'contested', formulation: 'Claim' },
      o1: { id: 'o1', type: 'objection', status: 'raised', formulation: 'Blocker', targetId: 'c1', severity: 'blocking', provenance: { turnId: 't2' } }
    } } }
  };

  test('keeps filters while switching Structure/Graf and opens provenance drawer', () => {
    const view = window.DisputStateMapView.init({ aggregate });
    document.querySelector('[data-map-collapse]').click();
    expect(document.querySelector('.disput-state-map-workspace').hidden).toBe(false);
    document.querySelector('[data-map-filter="blocking"]').click();
    expect(document.querySelector('[data-map-filter="blocking"]').classList.contains('is-active')).toBe(true);
    document.querySelector('[data-map-mode="graf"]').click();
    expect(document.querySelector('.disput-graf')).not.toBeNull();
    expect(document.querySelector('.disput-graf-links')).not.toBeNull();
    document.querySelector('[data-map-item="o1"]').click();
    expect(document.querySelector('[data-map-drawer]').hidden).toBe(false);
    expect(document.querySelector('[data-map-drawer]').textContent).toContain('Provenance');
    view.render({ ...aggregate, status: 'paused' });
    expect(document.querySelector('[data-map-filter="blocking"]').classList.contains('is-active')).toBe(true);
  });

  test('orders drawer controls and keeps System Information collapsed by default', () => {
    window.DisputStateMapView.init({ aggregate });
    document.querySelector('[data-map-collapse]').click();
    document.querySelector('[data-map-item="o1"]').click();
    const drawer = document.querySelector('[data-map-drawer]');
    const body = drawer.querySelector('.disput-map-drawer-body');
    const directChildren = [...body.children];
    expect(directChildren[0].className).toContain('disput-map-status-raised');
    expect(directChildren.map((element) => element.className)).toEqual(expect.arrayContaining([
      'disput-map-drawer-human-actions', 'disput-map-drawer-links', 'disput-map-drawer-source', 'disput-map-system-information'
    ]));
    expect(directChildren.indexOf(body.querySelector('.disput-map-drawer-human-actions')))
      .toBeLessThan(directChildren.indexOf(body.querySelector('.disput-map-drawer-links')));
    expect(directChildren.indexOf(body.querySelector('.disput-map-drawer-links')))
      .toBeLessThan(directChildren.indexOf(body.querySelector('.disput-map-drawer-source')));
    expect(directChildren.indexOf(body.querySelector('.disput-map-drawer-source')))
      .toBeLessThan(directChildren.indexOf(body.querySelector('.disput-map-system-information')));
    expect(body.querySelector('.disput-map-system-information').open).toBe(false);
    expect(body.querySelector('[data-map-source]').textContent).toContain('Перейти к исходному ответу');
  });

  test('shows removable human links in the drawer and above the open badge on the card', () => {
    const onLinkRemove = jest.fn();
    const humanAggregate = {
      ...aggregate,
      protocolState: { registry: { artifacts: {
        c1: { id: 'c1', type: 'claim', status: 'asserted', formulation: 'Claim' },
        h1: { id: 'h1', type: 'human_decision', status: 'accepted', formulation: 'assign', targetId: 'c1', provenance: { source: 'state_map_drawer' } },
        g1: { id: 'g1', type: 'evidence_gap', status: 'open', formulation: 'Need evidence', targetId: 'c1', provenance: { source: 'state_map_drawer' } }
      } } }
    };
    window.DisputStateMapView.init({ aggregate: humanAggregate, onLinkRemove });
    document.querySelector('[data-map-collapse]').click();
    const gapCard = document.querySelector('[data-map-item="g1"]');
    expect(gapCard.querySelector('[data-map-link-remove]').nextElementSibling.className).toContain('disput-map-badge');
    gapCard.querySelector('[data-map-link-remove]').click();
    expect(onLinkRemove).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'g1' }));
    document.querySelector('[data-map-item="c1"]').click();
    const drawerRemove = document.querySelector('.disput-map-drawer-links [data-map-link-remove]');
    expect(drawerRemove).not.toBeNull();
    drawerRemove.click();
    expect(onLinkRemove).toHaveBeenCalledWith(expect.objectContaining({ linkId: 'h1' }));
  });

  test('search reports hidden elements and empty states', () => {
    window.DisputStateMapView.init({ aggregate });
    document.querySelector('[data-map-collapse]').click();
    const search = document.querySelector('[data-map-search]'); search.value = 'missing'; search.dispatchEvent(new Event('input'));
    expect(document.querySelector('[data-map-content]').textContent).toContain('скрыто 2');
    expect(document.querySelector('[data-map-content]').textContent).toContain('Нет элементов');
  });

  test('collapses when clicking free page space but stays open inside the workspace', () => {
    window.DisputStateMapView.init({ aggregate });
    const toggle = document.querySelector('[data-map-collapse]');
    const workspace = document.querySelector('.disput-state-map-workspace');
    toggle.click();
    expect(workspace.hidden).toBe(false);
    document.querySelector('[data-map-content]').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(workspace.hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(workspace.hidden).toBe(true);
  });

  test('renders recoverable human-decision metadata and routes the selected option', () => {
    const onDecisionResolved = jest.fn();
    const decisionAggregate = {
      ...aggregate,
      pendingHumanDecision: {
        requestId: 'decision-reload-1', question: 'Continue?',
        reason: 'Participant dropped', affectedStageId: 'stage-4',
        options: [{ id: 'continue', label: 'Continue' }, { id: 'stop', label: 'Stop' }]
      }
    };
    const view = window.DisputStateMapView.init({ aggregate: decisionAggregate, onDecisionResolved });
    document.querySelector('[data-map-collapse]').click();
    const decision = document.querySelector('[data-decision-request="decision-reload-1"]');
    expect(decision.textContent).toEqual(expect.stringContaining('Request decision-reload-1'));
    expect(decision.textContent).toEqual(expect.stringContaining('Stage stage-4'));
    decision.querySelector('[data-map-decision-option="continue"]').click();
    expect(onDecisionResolved).toHaveBeenCalledWith({ requestId: 'decision-reload-1', optionId: 'continue' });
    view.render(JSON.parse(JSON.stringify(decisionAggregate)));
    expect(document.querySelector('[data-decision-request="decision-reload-1"]')).not.toBeNull();
  });

  test('renders contradiction provenance and persists conflict actions through the human-action port', () => {
    const onHumanAction = jest.fn();
    const conflictAggregate = {
      ...aggregate,
      protocolState: { registry: { artifacts: {
        c1: { id: 'c1', type: 'claim', status: 'contested', formulation: 'Claim' },
        x1: {
          id: 'x1', type: 'contradiction', status: 'recorded',
          formulation: 'Conflicting claims', targetId: 'c1',
          provenance: { turnId: 'turn-conflict' }
        }
      } } }
    };
    window.DisputStateMapView.init({ aggregate: conflictAggregate, onHumanAction });
    document.querySelector('[data-map-collapse]').click();
    const conflict = document.querySelector('[data-conflict-id="x1"]');
    expect(conflict.textContent).toContain('turn-conflict');
    conflict.querySelector('[data-map-human-action="request_evidence"]').click();
    expect(onHumanAction).toHaveBeenCalledWith(expect.objectContaining({ action: 'request_evidence', itemId: 'x1' }));
    expect(document.querySelector('[aria-live="polite"]')).not.toBeNull();
  });

  test('defers hidden map projection and materializes only the latest state when opened', () => {
    const project = jest.fn(StateMap.project);
    window.DebateStateMap = { ...StateMap, project };
    const view = window.DisputStateMapView.init({ aggregate });
    const callsAfterInit = project.mock.calls.length;
    expect(document.querySelector('[data-map-content]').childElementCount).toBe(0);

    view.render({ ...aggregate, status: 'paused' });
    view.render({ ...aggregate, status: 'completed' });
    expect(project.mock.calls.length).toBe(callsAfterInit);

    document.querySelector('[data-map-collapse]').click();
    expect(project.mock.calls.length).toBe(callsAfterInit + 1);
    expect(view.getMap().technicalStatus).toBe('completed');
    expect(document.querySelector('[data-map-content]').childElementCount).toBeGreaterThan(0);
  });
});

describe('Disput state map compact shell on pipeline page', () => {
  const aggregate = {
    runId: 'run-shell', status: 'running', config: { topic: 'Shell case' }, executionPlan: { profileId: 'UNIVERSAL_STANDARD' },
    protocolState: { registry: { artifacts: {} } }
  };

  const legacyPipelineMarkup = () => `<section id="disput-state-map-panel" data-status="not_ready"><button data-map-collapse aria-expanded="false"><span><strong data-map-title>Карта состояния</strong><small data-map-summary>legacy</small></span></button><div class="disput-state-map-workspace" hidden><header><span data-map-summary>legacy</span><select data-map-run><option value="">Текущее дело</option></select><div class="disput-state-map-actions"><button data-map-mode="structure">Структура</button><button data-map-mode="graf">Graf</button><button data-map-mode="history">История</button><button data-case-export><i class="ti ti-folder"></i></button><button data-map-export><i class="ti ti-download"></i></button><button data-case-import-action><i class="ti ti-upload"></i></button><button data-case-delete><i class="ti ti-trash"></i></button><button data-map-close>×</button></div></header><div class="disput-state-map-toolbar"><button data-map-filter="all">Все</button><input data-map-search><button data-map-compare>Сравнить</button><button data-map-zoom="reset">100%</button></div><div data-map-content>legacy content</div><aside data-map-drawer></aside></div></section>`;

  beforeEach(() => {
    jest.resetModules();
    document.body.className = 'pipeline-page';
    document.body.innerHTML = legacyPipelineMarkup();
    window.DebateStateMap = StateMap;
    if (!window.URL.createObjectURL) window.URL.createObjectURL = jest.fn(() => 'blob:test');
    if (!window.URL.revokeObjectURL) window.URL.revokeObjectURL = jest.fn();
    require('../results/disput-state-map-view');
  });

  afterEach(() => {
    document.body.className = '';
  });

  test('normalizes legacy pipeline markup to title plus exactly five icon actions', () => {
    window.DisputStateMapView.init({ aggregate });
    const panel = document.getElementById('disput-state-map-panel');

    expect(panel.dataset.mapShell).toBe('true');
    expect(panel.querySelector('[data-map-collapse]').textContent.trim()).toBe('Карта состояния');

    [
      '[data-map-mode]',
      '[data-map-filter]',
      '[data-map-search]',
      '[data-map-run]',
      '[data-map-summary]',
      '[data-map-compare]',
      '[data-map-zoom]',
      '[data-map-content]',
      '[data-map-drawer]'
    ].forEach((selector) => expect(panel.querySelector(selector)).toBeNull());

    const actions = panel.querySelector('.disput-state-map-actions');
    expect(actions.querySelectorAll('button')).toHaveLength(5);
    expect(actions.querySelector('[data-case-export]')).not.toBeNull();
    expect(actions.querySelector('[data-map-export]')).not.toBeNull();
    expect(actions.querySelector('[data-case-import-action]')).not.toBeNull();
    expect(actions.querySelector('[data-case-delete]')).not.toBeNull();
    expect(actions.querySelector('[data-map-close]')).not.toBeNull();
  });

  test('does not apply the compact shell outside pipeline page', () => {
    document.body.className = '';
    document.body.innerHTML = markup();
    jest.resetModules();
    window.DebateStateMap = StateMap;
    require('../results/disput-state-map-view');
    window.DisputStateMapView.init({ aggregate });
    expect(document.querySelector('[data-map-mode="structure"]')).not.toBeNull();
    expect(document.querySelector('[data-map-content]')).not.toBeNull();
  });
});
