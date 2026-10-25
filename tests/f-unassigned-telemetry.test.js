/** @jest-environment node */
const BasicTelemetry = require('../shared/basic-telemetry.js');

const createMockRun = (overrides = {}) => ({
  runId: 'run-f1',
  pipelineName: 'Pipeline F',
  lifecycle: 'RUNNING',
  startedAt: 1000,
  finishedAt: null,
  stopReason: null,
  attempts: [
    {
      step: 0,
      participant: 'C1',
      model: 'Claude',
      attempt: 1,
      visit: 1,
      phase: 'answer',
      state: 'done',
      accepted: true,
      transportRequestId: 'req-c1'
    }
  ],
  ...overrides
});

describe('Package F: Unassigned Observations and basic-telemetry/2 Export (C03 / ТЗ 5.F)', () => {
  test('format is basic-telemetry/2', () => {
    const customRun = createMockRun();
    const report = BasicTelemetry.buildReport({
      customRun,
      delivery: { journal: [] },
      events: []
    });

    expect(report.format).toBe('basic-telemetry/2');
    expect(report.runId).toBe('run-f1');
  });

  test('delivery.journal and telemetry.events contain ONLY selected entries; own runId with unknown requestId remains selected', () => {
    const customRun = createMockRun();

    // Event 1: belongs to attempt (known requestId req-c1) -> selected
    // Event 2: has own runId ('run-f1'), but unknown requestId ('req-unknown') -> MUST BE selected (not lost, not unassigned)
    // Event 3: unbound event with same model name but no runId or requestId -> unassigned
    // Event 4: event explicitly from another run ('run-other') -> otherRun
    const journal = [
      { eventId: 'ev-1', kind: 'dispatch', requestId: 'req-c1', model: 'Claude' },
      { eventId: 'ev-2', kind: 'completion_terminal', runId: 'run-f1', requestId: 'req-unknown', model: 'Claude', attemptCorrelation: 'unassigned' },
      { eventId: 'ev-3', kind: 'status', model: 'Claude', status: 'generating' },
      { eventId: 'ev-4', kind: 'dispatch', runId: 'run-other', requestId: 'req-other', model: 'Claude' }
    ];

    const report = BasicTelemetry.buildReport({
      customRun,
      delivery: { journal },
      events: []
    });

    const selectedIds = report.delivery.journal.map((e) => e.eventId);
    expect(selectedIds).toContain('ev-1');
    expect(selectedIds).toContain('ev-2');
    expect(selectedIds).not.toContain('ev-3');
    expect(selectedIds).not.toContain('ev-4');
  });

  test('delivery.unassigned and telemetry.unassigned collect unassigned entries with selectionReason', () => {
    const customRun = createMockRun();

    const journal = [
      { eventId: 'ev-linked', kind: 'dispatch', requestId: 'req-c1', model: 'Claude' },
      { eventId: 'ev-unbound', kind: 'status', model: 'Claude', status: 'thinking' }
    ];

    const telemetryEvents = [
      { eventId: 'tel-linked', event: 'stage_start', meta: { pipelineRunId: 'run-f1' } },
      { eventId: 'tel-unbound', event: 'background_heartbeat', model: 'Claude' }
    ];

    const report = BasicTelemetry.buildReport({
      customRun,
      delivery: { journal },
      events: telemetryEvents
    });

    // delivery.unassigned must be an array containing ev-unbound with selectionReason
    expect(Array.isArray(report.delivery.unassigned)).toBe(true);
    const unassignedDelivery = report.delivery.unassigned.find((e) => e.eventId === 'ev-unbound' || e.entry?.eventId === 'ev-unbound');
    expect(unassignedDelivery).toBeDefined();
    expect(unassignedDelivery.selectionReason || unassignedDelivery.reason).toBeDefined();

    // telemetry.unassigned must be an array containing tel-unbound with selectionReason
    expect(Array.isArray(report.telemetry.unassigned)).toBe(true);
    const unassignedTelemetry = report.telemetry.unassigned.find((e) => e.eventId === 'tel-unbound' || e.entry?.eventId === 'tel-unbound');
    expect(unassignedTelemetry).toBeDefined();
    expect(unassignedTelemetry.selectionReason || unassignedTelemetry.reason).toBeDefined();
  });

  test('conflicting run IDs in a single event route to unassigned with selectionReason conflicting_run_ids', () => {
    const customRun = createMockRun();

    // Event carries own runId in top-level, but a different runId in meta
    const conflictEvent = {
      eventId: 'ev-conflict',
      kind: 'dispatch',
      runId: 'run-f1',
      meta: { pipelineRunId: 'run-different' }
    };

    const report = BasicTelemetry.buildReport({
      customRun,
      delivery: { journal: [conflictEvent] },
      events: []
    });

    expect(report.delivery.journal.some((e) => e.eventId === 'ev-conflict')).toBe(false);

    expect(Array.isArray(report.delivery.unassigned)).toBe(true);
    const unassignedEntry = report.delivery.unassigned.find((e) => e.eventId === 'ev-conflict' || e.entry?.eventId === 'ev-conflict');
    expect(unassignedEntry).toBeDefined();
    expect(unassignedEntry.selectionReason || unassignedEntry.reason).toContain('conflict');
  });

  test('proven otherRun is excluded from both journal and unassigned', () => {
    const customRun = createMockRun();

    const otherRunEvent = {
      eventId: 'ev-other',
      kind: 'dispatch',
      runId: 'run-completely-different',
      requestId: 'req-other'
    };

    const report = BasicTelemetry.buildReport({
      customRun,
      delivery: { journal: [otherRunEvent] },
      events: []
    });

    expect(report.delivery.journal.some((e) => e.eventId === 'ev-other')).toBe(false);
    expect((report.delivery.unassigned || []).some((e) => (e.eventId || e.entry?.eventId) === 'ev-other')).toBe(false);
  });

  test('selection counters in delivery and telemetry: selected + unassigned + otherRun + invalid equal totalScanned', () => {
    const customRun = createMockRun();

    const journal = [
      { eventId: 'e1', kind: 'dispatch', requestId: 'req-c1' }, // selected
      { eventId: 'e2', kind: 'status', runId: 'run-f1' },       // selected (own runId)
      { eventId: 'e3', kind: 'status', model: 'GPT' },          // unassigned (unbound)
      { eventId: 'e4', kind: 'dispatch', runId: 'run-f1', meta: { pipelineRunId: 'run-other' } }, // unassigned (conflict)
      { eventId: 'e5', kind: 'dispatch', runId: 'run-other' },  // otherRun
      null                                                      // invalid
    ];

    const report = BasicTelemetry.buildReport({
      customRun,
      delivery: { journal },
      events: []
    });

    expect(report.delivery.selection).toBeDefined();
    const sel = report.delivery.selection;

    expect(sel.selected).toBe(2);
    expect(sel.unassigned).toBe(2);
    expect(sel.otherRun).toBe(1);
    expect(sel.invalid).toBe(1);
    expect(sel.totalScanned).toBe(6);
    expect(sel.selected + sel.unassigned + sel.otherRun + sel.invalid).toBe(sel.totalScanned);
  });
});
