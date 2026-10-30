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

describe('Package F: Unassigned Observations and basic-telemetry/3 Export (C03 / ТЗ 5.F)', () => {
  test('format is basic-telemetry/3', () => {
    const customRun = createMockRun();
    const report = BasicTelemetry.buildReport({
      customRun,
      delivery: { journal: [] },
      events: []
    });

    expect(report.format).toBe('basic-telemetry/3');
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

  describe('Package 8: Classification Integrity and Rounds Summary Truthfulness (C03 / R01)', () => {
    test('runSelection and attemptCorrelation are independent axes', () => {
      const customRun = createMockRun();

      const journal = [
        // 1. Own run + unknown requestId -> selected + unassigned
        { eventId: 'e-own-unknown', kind: 'completion_terminal', runId: 'run-f1', requestId: 'req-unseen', model: 'Claude' },
        // 2. Known run + attempt conflict -> selected + conflict
        { eventId: 'e-own-conflict', kind: 'completion_terminal', runId: 'run-f1', requestId: 'req-c1', attemptCorrelation: 'conflict' },
        // 3. Known run + linked request -> selected + linked
        { eventId: 'e-own-linked', kind: 'completion_terminal', runId: 'run-f1', requestId: 'req-c1' },
        // 4. Conflicting run IDs -> unassigned + conflicting_run_ids
        { eventId: 'e-run-conflict', kind: 'status', runId: 'run-f1', meta: { pipelineRunId: 'run-other' }, model: 'Claude' },
        // 5. Other run -> otherRun
        { eventId: 'e-other-run', kind: 'status', runId: 'run-other', model: 'Claude' }
      ];

      const report = BasicTelemetry.buildReport({
        customRun,
        delivery: { journal },
        events: []
      });

      const selected = report.delivery.journal;
      const unassigned = report.delivery.unassigned;

      // 1. e-own-unknown is selected with attemptCorrelation: unassigned
      const ownUnknown = selected.find((e) => e.eventId === 'e-own-unknown');
      expect(ownUnknown).toBeDefined();
      expect(ownUnknown.runSelection).toBe('selected');
      expect(ownUnknown.attemptCorrelation).toBe('unassigned');
      expect(ownUnknown.requestId).toBe('req-unseen');

      // 2. e-own-conflict is selected with attemptCorrelation: conflict
      const ownConflict = selected.find((e) => e.eventId === 'e-own-conflict');
      expect(ownConflict).toBeDefined();
      expect(ownConflict.runSelection).toBe('selected');
      expect(ownConflict.attemptCorrelation).toBe('conflict');

      // 3. e-own-linked is selected with attemptCorrelation: linked
      const ownLinked = selected.find((e) => e.eventId === 'e-own-linked');
      expect(ownLinked).toBeDefined();
      expect(ownLinked.runSelection).toBe('selected');
      expect(ownLinked.attemptCorrelation).toBe('linked');

      // 4. e-run-conflict is unassigned with selectionReason conflicting_run_ids
      const runConflict = unassigned.find((e) => e.eventId === 'e-run-conflict');
      expect(runConflict).toBeDefined();
      expect(runConflict.selectionReason).toBe('conflicting_run_ids');
      expect(runConflict.runConflictEvidence).toEqual(expect.arrayContaining(['run-f1', 'run-other']));

      // 5. Selection counters
      expect(report.delivery.selection.selected).toBe(3);
      expect(report.delivery.selection.unassigned).toBe(1);
      expect(report.delivery.selection.otherRun).toBe(1);
      expect(report.delivery.selection.totalScanned).toBe(5);
    });

    test('rounds summary: participant rejected in attempt 1 and accepted in attempt 2 is accepted, once', () => {
      const customRun = {
        runId: 'run-retry-fix',
        steps: [{ ref: 'r1', kind: 'round', models: [{ id: 'C1', name: 'Claude' }] }],
        attempts: [
          { ref: 'r1', visit: 1, participant: 'C1', attempt: 1, state: 'done', accepted: false, transportRequestId: 'req-fail' },
          { ref: 'r1', visit: 1, participant: 'C1', attempt: 2, state: 'done', accepted: true, transportRequestId: 'req-ok' }
        ],
        waits: []
      };

      const report = BasicTelemetry.buildReport({
        customRun,
        delivery: { journal: [] },
        events: []
      });

      const round = report.rounds[0];
      expect(round).toBeDefined();
      expect(round.participants).toEqual([
        { participant: 'C1', model: 'Claude', outcome: 'accepted', reason: null, status: null, attempts: 2, transportRequestId: 'req-ok' }
      ]);
    });

    test('rounds summary: expectedParticipants preserves distinct participant IDs for multiple instances of same provider', () => {
      const customRun = {
        runId: 'run-multi-claude',
        steps: [
          {
            ref: 'r1',
            kind: 'round',
            models: [
              { id: 'C1', name: 'Claude' },
              { id: 'C2', name: 'Claude' }
            ]
          }
        ],
        attempts: [
          { ref: 'r1', visit: 1, participant: 'C1', attempt: 1, state: 'done', accepted: true, transportRequestId: 'req-1' },
          { ref: 'r1', visit: 1, participant: 'C2', attempt: 1, state: 'done', accepted: true, transportRequestId: 'req-2' }
        ],
        waits: []
      };

      const report = BasicTelemetry.buildReport({
        customRun,
        delivery: { journal: [] },
        events: []
      });

      const round = report.rounds[0];
      expect(round.expectedParticipants).toEqual(['C1', 'C2']); // Distinct participant IDs, not ['Claude', 'Claude']
    });

    test('rounds summary: sentCount counts only confirmed dispatches and excludes cancelled_before_dispatch', () => {
      const customRun = {
        runId: 'run-sent-count',
        steps: [{ ref: 'r1', kind: 'round', models: [{ id: 'A', name: 'M' }, { id: 'B', name: 'M' }, { id: 'C', name: 'M' }] }],
        attempts: [
          // A: dispatched and completed -> counted
          { ref: 'r1', visit: 1, participant: 'A', attempt: 1, state: 'done', accepted: true, sentAt: 1000, transportRequestId: 'req-a' },
          // B: dispatched, in-flight/interrupted -> counted
          { ref: 'r1', visit: 1, participant: 'B', attempt: 1, state: 'unknown', reason: 'interrupted_in_flight', sentAt: 1050, transportRequestId: 'req-b' },
          // C: wave never dispatched -> NOT counted
          { ref: 'r1', visit: 1, participant: 'C', attempt: 1, state: 'not_sent', reason: 'cancelled_before_dispatch', sentAt: null, transportRequestId: null }
        ],
        waits: []
      };

      const report = BasicTelemetry.buildReport({
        customRun,
        delivery: { journal: [] },
        events: []
      });

      const round = report.rounds[0];
      expect(round.attemptCount).toBe(3);
      expect(round.sentCount).toBe(2); // Only A and B were actually sent!
    });

    test('rounds summary: unclosed wait returns null userWaitDurationMs with reason unclosed_wait instead of 0', () => {
      const customRun = {
        runId: 'run-open-wait',
        steps: [{ ref: 'r1', kind: 'round', models: [{ id: 'C1', name: 'Claude' }] }],
        attempts: [{ ref: 'r1', visit: 1, participant: 'C1', attempt: 1, state: 'done', accepted: true, transportRequestId: 'req-1' }],
        waits: [
          // Open wait (crash or in-progress)
          { waitId: 'w-open', kind: 'decision', stepRef: 'r1', visit: 1, startedAt: 5000, endedAt: null, outcome: null }
        ]
      };

      const report = BasicTelemetry.buildReport({
        customRun,
        delivery: { journal: [] },
        events: []
      });

      const round = report.rounds[0];
      expect(round.userWaitDurationMs).toBeNull(); // Must NOT be 0!
      expect(round.userWaitDurationReason).toBe('unclosed_wait');
    });
  });
});
