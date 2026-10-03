const Orchestrator = require('../disput/debate-orchestrator');
const Planner = require('../disput/debate-planner');
const StageExecutor = require('../disput/debate-stage-executor');
const PlanRevision = require('../disput/debate-plan-revision');
const Policies = require('../disput/debate-policies');

function makePersistence() {
  const store = { events: [], snapshots: [], lease: null };
  return {
    store,
    appendEvent: (event) => { store.events.push(JSON.parse(JSON.stringify(event))); },
    loadEvents: (afterSequence = 0) => store.events.filter((e) => e.eventSequence > afterSequence),
    saveSnapshot: (snapshot) => { store.snapshots.push(JSON.parse(JSON.stringify(snapshot))); },
    loadLatestSnapshot: () => store.snapshots[store.snapshots.length - 1] || null,
    readLease: () => store.lease,
    writeLease: (value) => { store.lease = JSON.parse(JSON.stringify(value)); return true; }
  };
}

function makeCase(overrides = {}) {
  return {
    caseId: 'run-1', version: 1,
    topic: { title: 'test' },
    constraints: [],
    participants: [
      { participantId: 'alpha', type: 'llm', model: 'alpha', capabilities: [], capacity: 2 },
      { participantId: 'beta', type: 'llm', model: 'beta', capabilities: [], capacity: 2 }
    ],
    openGoals: [{
      goalId: 'g1', type: 'verify_claim', targetArtifactIds: ['claim:1'], status: 'open',
      priority: 50, createdFromEventId: 'e0', createdAt: '2026-07-22T00:00:00.000Z'
    }],
    policies: Policies.resolve({ finalization: { mode: 'manual' } }),
    ...overrides
  };
}

function makeOrchestrator(options = {}) {
  const persistence = options.persistence || makePersistence();
  const revisions = PlanRevision.createRevisionStore({});
  const adapterBehavior = options.adapterBehavior || (({ participant }) => ({ status: 'received', text: `answer:${participant.participantId}` }));
  const adapters = StageExecutor.createAdapterRegistry({
    llm: { type: 'llm', dispatch: async (ctx) => adapterBehavior(ctx) },
    human: StageExecutor.createHumanAdapter()
  });
  const executor = StageExecutor.createStageExecutor({
    adapters,
    acceptResponse: (text) => ({ ok: Boolean(String(text || '').trim()), reason: 'empty' }),
    extractArtifacts: ({ stage, participant, text }) => [{
      id: `artifact-${stage.stageInstanceId}-${participant.participantId}`,
      type: ({
        position: 'claim', verification: 'evidence', evidence_review: 'evidence',
        response: 'revision', synthesis: 'synthesis_conclusion', audit: 'audit',
        human_judgment: 'human_decision'
      }[stage.purpose] || 'finding'),
      status: stage.purpose === 'audit' ? 'verified' : 'recorded',
      targetId: stage.inputArtifactIds?.[0] || '',
      text
    }],
    proposeStateDelta: options.proposeStateDelta === null
      ? () => null
      : (typeof options.proposeStateDelta === 'function'
        ? options.proposeStateDelta
        : (({ stage, participant, artifacts }) => ({
          stageId: stage.stageInstanceId,
          by: participant.participantId,
          goalIds: stage.goalIds,
          artifacts
        }))),
    retryPolicy: { maxAttempts: 1, delayMs: 0 },
    emit: () => {}
  });
  const commitStateDelta = options.commitStateDelta === undefined
    ? ({ state, delta }) => ({
      applied: true,
      changed: true,
      appliedArtifactIds: (delta.artifacts || []).map((artifact) => artifact.id),
      stateMap: state.stateMap
    })
    : options.commitStateDelta;
  const orchestrator = Orchestrator.createOrchestrator({
    planner: Planner.createPlanner(),
    executor,
    revisionStore: revisions,
    persistence,
    ownerId: options.ownerId,
    now: options.now,
    leaseTtlMs: options.leaseTtlMs,
    leaseHeartbeatMs: options.leaseHeartbeatMs,
    setInterval: options.setInterval,
    clearInterval: options.clearInterval,
    commitStateDelta,
    emit: options.emit,
    AbortController,
    exposeInternals: true
  });
  return { orchestrator, revisions, persistence };
}

function makeTerminalAwareOrchestrator(options = {}) {
  const persistence = options.persistence || makePersistence();
  const revisions = PlanRevision.createRevisionStore({});
  const executor = {
    execute: jest.fn(async (stage) => ({
      stageInstanceId: stage.stageInstanceId,
      executionStatus: 'partial', attempts: [],
      acceptedResponses: [{ participantId: 'alpha', text: 'accepted', artifacts: [] }],
      proposedStateDeltas: [{ by: 'alpha' }], awaitingParticipants: [], failedParticipants: ['beta'],
      terminalFailures: [{ participantId: 'beta', terminal: true, reasonCode: 'ERROR', stageId: stage.stageInstanceId, attemptId: `${stage.stageInstanceId}:a1` }]
    }))
  };
  return Orchestrator.createOrchestrator({
    planner: Planner.createPlanner(), executor, revisionStore: revisions, persistence,
    ownerId: 'owner-terminal', AbortController, exposeInternals: true
  });
}

const types = (state) => state.events.map((e) => e.type);

describe('Orchestrator — run lifecycle', () => {
  test('quota exhaustion does not interrupt stage completion or event publication', async () => {
    const Persistence = require('../disput/debate-orchestrator-persistence');
    const values = new Map();
    const storage = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        if (!key.endsWith(':lease') && value.length > 1000) {
          throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
        }
        values.set(key, value);
      },
      removeItem: key => values.delete(key)
    };
    const persistence = Persistence.createPersistence({ runId: 'run-1', storage });
    const emit = jest.fn();
    const { orchestrator } = makeOrchestrator({ persistence, emit, adapterBehavior: () => ({ status: 'received', text: 'x'.repeat(10000) }) });
    expect((await orchestrator.startRun({ debateCase: makeCase() })).ok).toBe(true);
    expect(types(orchestrator.getState())).toContain('STAGE_COMPLETED');
    await orchestrator.requestPause({ requestedBy: 'test' });
    expect(orchestrator.getState().lifecycle).toBe('PAUSED');
    expect(persistence.loadEvents()).toEqual(orchestrator.getState().events);
    expect(emit.mock.calls.map(call => call[0])).toContain('STAGE_COMPLETED');
    expect(persistence.getStorageStatus().mode).toBe('memory');
  });

  test('startRun requires a pre-created DebateCase (Slice B order)', async () => {
    const { orchestrator } = makeOrchestrator();
    expect((await orchestrator.startRun({})).code).toBe('DEBATE_CASE_REQUIRED');
  });

  test('full cycle: start → planner tick → stage → StateDelta commit → goal resolved', async () => {
    const { orchestrator } = makeOrchestrator();
    const result = await orchestrator.startRun({ debateCase: makeCase() });
    expect(result.ok).toBe(true);
    const state = orchestrator.getState();
    expect(types(state)).toEqual(expect.arrayContaining([
      'RUN_CREATED', 'RUN_STARTED', 'PLANNING_STARTED', 'PLANNING_COMPLETED',
      'STAGE_CREATED', 'STAGE_STARTED', 'STATE_DELTA_PROPOSED', 'STATE_DELTA_APPLIED', 'STAGE_COMPLETED'
    ]));
    expect(state.openGoals.find((g) => g.goalId === 'g1').status).toBe('resolved');
    expect(state.lifecycle).toBe('RUNNING'); // manual finalization policy → waits for command
  });

  test('stage created only after persisted PLANNING_COMPLETED (§10)', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase() });
    const events = orchestrator.getState().events;
    const planningIndex = events.findIndex((e) => e.type === 'PLANNING_COMPLETED');
    const stageIndex = events.findIndex((e) => e.type === 'STAGE_CREATED');
    expect(planningIndex).toBeGreaterThan(-1);
    expect(stageIndex).toBeGreaterThan(planningIndex);
  });

  test('active revision planned stage becomes an executable StageInstance with stable linkage', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({
      debateCase: makeCase({ openGoals: [] }),
      plannedStages: [{
        plannedStageId: 'planned-explicit-synthesis',
        purpose: 'synthesis',
        status: 'pending',
        participantIds: ['beta'],
        activationPolicy: 'immediate',
        outputIntent: 'candidate_final',
        terminalPolicy: 'eligible_for_finalization'
      }],
      maxSteps: 1
    });
    const stage = orchestrator.getState().stages[0];
    expect(stage).toMatchObject({
      plannedStageId: 'planned-explicit-synthesis',
      purpose: 'synthesis',
      outputIntent: 'candidate_final',
      terminalPolicy: 'eligible_for_finalization',
      status: 'completed'
    });
    expect(stage.participants.map((participant) => participant.participantId)).toEqual(['beta']);
  });

  test('finalizeRun completes without synthesis (state_map terminal outcome §18.1)', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase() });
    const finalized = await orchestrator.finalizeRun({ reason: 'MANUAL_STOP', finalizationMode: 'STATE_MAP' });
    expect(finalized.ok).toBe(true);
    expect(orchestrator.getState().lifecycle).toBe('COMPLETED');
    // Duplicate finalization is idempotent (§21).
    const again = await orchestrator.finalizeRun({});
    expect(again.deduplicated).toBe(true);
  });

  test('no-state-change responses increment stagnation signals and reopen goal (§12.2)', async () => {
    const { orchestrator } = makeOrchestrator({ proposeStateDelta: null });
    await orchestrator.startRun({ debateCase: makeCase(), maxSteps: 3 });
    const state = orchestrator.getState();
    expect(types(state)).toContain('NO_STATE_CHANGE');
    expect(state.openGoals.find((g) => g.goalId === 'g1').status).toBe('open');
  });

  test('missing legacy commit port fails closed and emits a degradation diagnostic', async () => {
    const { orchestrator } = makeOrchestrator({ commitStateDelta: null });
    await orchestrator.startRun({ debateCase: makeCase(), maxSteps: 1 });
    const state = orchestrator.getState();
    expect(state.caseVersion).toBe(1);
    expect(state.openGoals.find((goal) => goal.goalId === 'g1').status).toBe('open');
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'SEMANTIC_COMMIT_DEGRADED', payload: expect.objectContaining({ reason: 'commit_port_missing' }) }),
      expect.objectContaining({ type: 'STATE_DELTA_REJECTED', payload: expect.objectContaining({ reason: 'commit_port_missing' }) })
    ]));
    expect(types(state)).not.toContain('STATE_DELTA_APPLIED');
  });

  test('unsupported goal criteria remain open instead of resolving on stage completion', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({
      debateCase: makeCase({
        openGoals: [{
          goalId: 'custom-goal', type: 'custom_goal', targetArtifactIds: [], status: 'open',
          priority: 50, createdFromEventId: 'e0', createdAt: '2026-07-22T00:00:00.000Z'
        }]
      }),
      maxSteps: 1
    });
    const event = orchestrator.getState().events.find((item) => item.type === 'GOAL_EVALUATED');
    expect(event.payload).toMatchObject({ goalId: 'custom-goal', outcome: 'progressed', status: 'open' });
    expect(orchestrator.getState().openGoals.find((goal) => goal.goalId === 'custom-goal').status).toBe('open');
  });

  test('applied without an explicit changed boolean is rejected as a commit contract violation', async () => {
    const { orchestrator } = makeOrchestrator({
      commitStateDelta: ({ state }) => ({ applied: true, stateMap: state.stateMap })
    });
    await orchestrator.startRun({ debateCase: makeCase(), maxSteps: 1 });
    const state = orchestrator.getState();
    expect(state.caseVersion).toBe(1);
    expect(state.openGoals.find((goal) => goal.goalId === 'g1').status).toBe('open');
    expect(state.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'SEMANTIC_COMMIT_CONTRACT_VIOLATION',
        payload: expect.objectContaining({ reason: 'changed_boolean_required' })
      }),
      expect.objectContaining({
        type: 'STATE_DELTA_REJECTED',
        payload: expect.objectContaining({ reason: 'commit_change_undetermined' })
      })
    ]));
  });

  test('a changed but criterion-incompatible artifact does not resolve a goal', async () => {
    const { orchestrator } = makeOrchestrator({
      proposeStateDelta: ({ stage, participant }) => ({
        deltaId: `delta-${participant.participantId}`,
        goalIds: stage.goalIds,
        artifacts: [{ id: 'unrelated', type: 'finding', status: 'recorded' }]
      })
    });
    await orchestrator.startRun({ debateCase: makeCase(), maxSteps: 1 });
    const state = orchestrator.getState();
    expect(state.openGoals.find((goal) => goal.goalId === 'g1').status).toBe('open');
    expect(state.events.find((item) => item.type === 'GOAL_EVALUATED').payload)
      .toMatchObject({ goalId: 'g1', outcome: 'progressed', reason: 'acceptance_criterion_not_met' });
  });

  test('terminal participant failure makes the participant unavailable for later planning', async () => {
    const orchestrator = makeTerminalAwareOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), maxSteps: 1 });
    const state = orchestrator.getState();
    expect(state.participantStatus.beta).toEqual(expect.objectContaining({ available: false, terminal: true, reasonCode: 'ERROR' }));
    expect(types(state)).toContain('PARTICIPANT_UNAVAILABLE');
    const input = orchestrator._internals.plannerInput();
    expect(input.availableParticipants.find((participant) => participant.participantId === 'beta').available).toBe(false);
    expect(input.availableParticipants.find((participant) => participant.participantId === 'alpha').available).toBe(true);
    expect(state.configuredParticipants).toEqual(['alpha', 'beta']);
    expect(state.activeParticipants).toEqual(['alpha']);
    expect(state.droppedParticipants).toEqual([expect.objectContaining({ participantId: 'beta', terminal: true })]);
  });

  test('parallel stage deltas from one base version commit atomically with one version increment', async () => {
    const revisions = PlanRevision.createRevisionStore({});
    const executor = { execute: async (stage) => ({
      stageInstanceId: stage.stageInstanceId, executionStatus: 'completed', attempts: [],
      acceptedResponses: [], awaitingParticipants: [], failedParticipants: [], terminalFailures: [],
      proposedStateDeltas: [
        { deltaId: 'd-alpha', expectedCaseVersion: 1, artifacts: [{ id: 'a-alpha' }] },
        { deltaId: 'd-beta', expectedCaseVersion: 1, artifacts: [{ id: 'a-beta' }] }
      ]
    }) };
    const commitStateDelta = ({ state, delta }) => {
      state.debateCase.artifacts = [...(state.debateCase.artifacts || []), ...delta.artifacts];
      return { applied: true, changed: true, stateMap: { artifactIds: state.debateCase.artifacts.map((artifact) => artifact.id) } };
    };
    const orchestrator = Orchestrator.createOrchestrator({
      planner: Planner.createPlanner(), executor, revisionStore: revisions, persistence: makePersistence(),
      commitStateDelta, ownerId: 'owner-atomic', AbortController, exposeInternals: true
    });
    await orchestrator.startRun({ debateCase: makeCase({ artifacts: [] }), maxSteps: 1 });
    const state = orchestrator.getState();
    expect(state.caseVersion).toBe(2);
    expect(state).not.toHaveProperty('stateMapVersion');
    expect(state.stateMap.artifactIds).toEqual(['a-alpha', 'a-beta']);
    expect(state.events.filter((event) => event.type === 'STATE_DELTA_APPLIED')).toHaveLength(2);
    expect(state.events.filter((event) => event.type === 'STATE_DELTA_STALE')).toHaveLength(0);
  });
});

describe('Orchestrator — ownership (§6)', () => {
  test('second orchestrator cannot acquire an active lease', async () => {
    const persistence = makePersistence();
    const first = makeOrchestrator({ persistence, ownerId: 'owner-1' });
    await first.orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    const second = makeOrchestrator({ persistence, ownerId: 'owner-2' });
    const result = await second.orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('LEASE_HELD');
  });

  test('expired lease can be taken over', async () => {
    const persistence = makePersistence();
    let clock = 1000;
    const first = makeOrchestrator({ persistence, ownerId: 'owner-1', now: () => clock, leaseTtlMs: 100 });
    await first.orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    clock += 1000; // lease expired
    const second = makeOrchestrator({ persistence, ownerId: 'owner-2', now: () => clock, leaseTtlMs: 100 });
    const result = await second.orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    expect(result.ok).toBe(true);
  });

  test('a former owner cannot commit a delayed stage after its lease is fenced out', async () => {
    const persistence = makePersistence();
    let resolveDispatch;
    const delayed = new Promise((resolve) => { resolveDispatch = resolve; });
    const first = makeOrchestrator({
      persistence, ownerId: 'owner-1', now: () => 1000, leaseTtlMs: 10,
      adapterBehavior: async () => delayed
    });
    const running = first.orchestrator.startRun({ debateCase: makeCase(), maxSteps: 1 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A different owner writes a newer fencing revision while the provider is slow.
    persistence.writeLease({ runId: 'run-1', ownerId: 'owner-2', expiresAt: 99999, leaseRevision: 2, version: 2 });
    resolveDispatch({ status: 'received', text: 'late answer' });
    const result = await running;
    expect(result.outcome.code).toBe('LEASE_LOST');
    expect(first.orchestrator.getState().events.map((event) => event.type)).toContain('LEASE_LOST');
    expect(first.orchestrator.getState().events.map((event) => event.type)).not.toContain('STATE_DELTA_APPLIED');
  });

  test('renews the lease while waiting for a slow model response', async () => {
    const persistence = makePersistence();
    let clock = 1000;
    let heartbeat = null;
    const { orchestrator } = makeOrchestrator({
      persistence,
      ownerId: 'owner-slow-model',
      now: () => clock,
      leaseTtlMs: 30,
      leaseHeartbeatMs: 10,
      setInterval: (callback) => { heartbeat = callback; return { unref() {} }; },
      clearInterval: () => { heartbeat = null; },
      adapterBehavior: async ({ participant }) => {
        clock += 20;
        heartbeat();
        clock += 20;
        heartbeat();
        return { status: 'received', text: `slow answer:${participant.participantId}` };
      }
    });

    const result = await orchestrator.startRun({ debateCase: makeCase(), maxSteps: 1 });

    expect(result.ok).toBe(true);
    expect(orchestrator.getState().stages[0].status).toBe('completed');
    expect(orchestrator.getState().lifecycle).toBe('RUNNING');
    expect(persistence.store.lease.expiresAt).toBeGreaterThan(clock);
  });
});

describe('Orchestrator — pause/continue (§13–§14)', () => {
  test('pause emits QUIESCING then PAUSED with snapshot; continue reconciles and replans', async () => {
    const { orchestrator, persistence } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    const paused = await orchestrator.requestPause({ requestedBy: 'user' });
    expect(paused.lifecycle).toBe('PAUSED');
    expect(types(orchestrator.getState())).toEqual(expect.arrayContaining(['PAUSE_REQUESTED', 'RUN_QUIESCING', 'RUN_PAUSED']));
    expect(persistence.store.snapshots.length).toBeGreaterThan(0);
    expect(persistence.store.lease).toBeNull();
    const resumed = await orchestrator.requestContinue({ requestedBy: 'user' });
    expect(resumed.ok).toBe(true);
    expect(types(orchestrator.getState())).toEqual(expect.arrayContaining(['CONTINUE_REQUESTED', 'RECONCILING_STARTED', 'RECONCILING_COMPLETED', 'RUN_RESUMED']));
  });

  test('no stages are created after pause request (§4.5)', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    await orchestrator.requestPause({});
    const stagesBefore = orchestrator.getState().stages.length;
    const tick = await orchestrator._internals.plannerTick();
    expect(tick.ok).toBe(false);
    expect(orchestrator.getState().stages.length).toBe(stagesBefore);
  });

  test('continue with stale expectedCaseVersion is rejected', async () => {
    const { orchestrator, persistence } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    await orchestrator.requestPause({});
    const result = await orchestrator.requestContinue({ expectedCaseVersion: 999 });
    expect(result.code).toBe('CASE_VERSION_STALE');
    expect(persistence.store.lease).toBeNull();
  });
});

describe('Orchestrator — recovery (§15)', () => {
  test('run survives reload: snapshot + replay restores paused state, continue works', async () => {
    const persistence = makePersistence();
    const first = makeOrchestrator({ persistence, ownerId: 'owner-1' });
    await first.orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    await first.orchestrator.requestPause({});
    // Simulate reload: fresh orchestrator over same persistence.
    let clock = Date.now() + 60_000;
    const second = makeOrchestrator({ persistence, ownerId: 'owner-2', now: () => clock });
    const recovered = await second.orchestrator.recoverRun({});
    expect(recovered.ok).toBe(true);
    expect(recovered.lifecycle).toBe('PAUSED');
    const resumed = await second.orchestrator.requestContinue({});
    expect(resumed.ok).toBe(true);
    expect(second.orchestrator.getState().lifecycle).toBe('RUNNING');
  });

  test('recovery migrates pre-collection snapshots from persisted participant status', async () => {
    const persistence = makePersistence();
    const first = makeOrchestrator({ persistence, ownerId: 'owner-1' });
    await first.orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    await first.orchestrator.requestPause({});
    const snapshot = persistence.store.snapshots.at(-1);
    delete snapshot.configuredParticipants;
    delete snapshot.activeParticipants;
    delete snapshot.droppedParticipants;
    snapshot.participantStatus = { beta: { available: false, terminal: true, reasonCode: 'ERROR' } };
    const second = makeOrchestrator({ persistence, ownerId: 'owner-2', now: () => Date.now() + 60000 });
    await second.orchestrator.recoverRun({ deferExecution: true });
    expect(second.orchestrator.getState().activeParticipants).toEqual(['alpha']);
    expect(second.orchestrator.getState().droppedParticipants).toEqual([expect.objectContaining({ participantId: 'beta' })]);
  });

  test('recovery with nothing persisted is rejected cleanly', async () => {
    const { orchestrator } = makeOrchestrator();
    expect((await orchestrator.recoverRun({})).code).toBe('NOTHING_TO_RECOVER');
  });
});

describe('Orchestrator — human participant (Slice F)', () => {
  const humanCase = () => makeCase({
    participants: [{ participantId: 'human:owner', type: 'human', capabilities: [] }],
    openGoals: [{
      goalId: 'g-h', type: 'answer_open_question', targetArtifactIds: ['q1'], status: 'open',
      priority: 50, createdFromEventId: 'e0', createdAt: '2026-07-22T00:00:00.000Z'
    }]
  });

  test('human stage awaits participant; submitParticipantResponse completes it through the artifact pipeline', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: humanCase() });
    const state = orchestrator.getState();
    const awaiting = state.stages.find((s) => s.status === 'awaiting_participant');
    expect(awaiting).toBeTruthy();
    const submitted = await orchestrator.submitParticipantResponse({
      stageInstanceId: awaiting.stageInstanceId, participantId: 'human:owner',
      text: 'my answer',
      stateDelta: {
        kind: 'answer',
        goalIds: ['g-h'],
        artifacts: [{ id: 'human-answer', type: 'revision', status: 'recorded', targetId: 'q1' }]
      },
      deferExecution: true
    });
    expect(submitted.ok).toBe(true);
    const after = orchestrator.getState();
    expect(types(after)).toEqual(expect.arrayContaining(['PARTICIPANT_RESPONSE_SUBMITTED', 'STATE_DELTA_APPLIED', 'STAGE_COMPLETED']));
    expect(after.openGoals.find((g) => g.goalId === 'g-h').status).toBe('resolved');
  });

  test('persists a blocking human decision and rejects stale or duplicate resolution', async () => {
    const persistence = makePersistence();
    const first = makeOrchestrator({ persistence, ownerId: 'owner-1' });
    await first.orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    first.orchestrator._internals.state.pendingHumanDecision = {
      requestId: 'decision-1', question: 'Continue?', blocking: true,
      options: [{ id: 'continue' }, { id: 'stop' }]
    };
    await first.orchestrator.requestPause({});
    const second = makeOrchestrator({ persistence, ownerId: 'owner-2', now: () => Date.now() + 60000 });
    await second.orchestrator.recoverRun({ deferExecution: true });
    expect(second.orchestrator.getState().pendingHumanDecision).toMatchObject({ requestId: 'decision-1' });
    expect(second.orchestrator.resolveHumanDecision({ requestId: 'other', optionId: 'continue' })).toMatchObject({ ok: false, code: 'DECISION_REQUEST_STALE' });
    const resolved = second.orchestrator.resolveHumanDecision({ requestId: 'decision-1', optionId: 'continue', expectedCaseVersion: 1, expectedPlanRevisionId: second.orchestrator.getState().activePlanRevisionId });
    expect(resolved.ok).toBe(true);
    expect(second.orchestrator.resolveHumanDecision({ requestId: 'decision-1', optionId: 'continue' })).toMatchObject({ ok: false, code: 'NO_PENDING_DECISION' });
  });

  test('duplicate human response is rejected (§21 idempotency)', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: humanCase() });
    const awaiting = orchestrator.getState().stages.find((s) => s.status === 'awaiting_participant');
    await orchestrator.submitParticipantResponse({ stageInstanceId: awaiting.stageInstanceId, participantId: 'human:owner', text: 'a', deferExecution: true });
    const duplicate = await orchestrator.submitParticipantResponse({ stageInstanceId: awaiting.stageInstanceId, participantId: 'human:owner', text: 'b', deferExecution: true });
    expect(duplicate.code).toBe('STAGE_NOT_AWAITING');
  });

  test('unassigned participant cannot answer the stage', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: humanCase() });
    const awaiting = orchestrator.getState().stages.find((s) => s.status === 'awaiting_participant');
    const result = await orchestrator.submitParticipantResponse({ stageInstanceId: awaiting.stageInstanceId, participantId: 'intruder', text: 'x' });
    expect(result.code).toBe('PARTICIPANT_NOT_ASSIGNED');
  });
});

describe('Orchestrator — interventions (§16)', () => {
  test('REQUEST_VERIFICATION intervention creates a human-requested goal and replans', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    const result = await orchestrator.submitIntervention({
      interventionId: 'iv-1', type: 'REQUEST_VERIFICATION', payload: { artifactIds: ['claim:9'] }, deferExecution: true
    });
    expect(result.ok).toBe(true);
    const state = orchestrator.getState();
    expect(state.openGoals.some((g) => g.goalId === 'goal-verify-iv-1' && g.humanRequested)).toBe(true);
    expect(types(state)).toEqual(expect.arrayContaining(['INTERVENTION_RECORDED', 'INTERVENTION_APPLIED']));
  });

  test('duplicate intervention id is rejected', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    await orchestrator.submitIntervention({ interventionId: 'iv-1', type: 'ADD_CONSTRAINT', payload: { constraint: { text: 'x' } }, deferExecution: true });
    const duplicate = await orchestrator.submitIntervention({ interventionId: 'iv-1', type: 'ADD_CONSTRAINT', payload: { constraint: { text: 'x' } }, deferExecution: true });
    expect(duplicate.code).toBe('DUPLICATE_INTERVENTION');
  });

  test('STOP_RUN intervention finalizes through the single finalization path', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    await orchestrator.submitIntervention({ interventionId: 'iv-stop', type: 'STOP_RUN', payload: {}, deferExecution: true });
    expect(orchestrator.getState().lifecycle).toBe('COMPLETED');
    expect(orchestrator.getState().finalization.reason).toBe('MANUAL_STOP');
  });
});

describe('Orchestrator — plan revisions (§17)', () => {
  test('revision command invalidates pending stages of superseded revision and reopens goals', async () => {
    const { orchestrator, revisions } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    // Create a pending stage under the initial revision without executing it.
    const tick = await orchestrator._internals.plannerTick();
    expect(tick.ok).toBe(true);
    const internals = orchestrator._internals;
    const decision = tick.decision;
    expect(decision.type).toBe('CREATE_STAGES');
    const stagesBefore = orchestrator.getState().stages.length;
    // Apply revision: the pending stage's planRevisionId becomes stale.
    internalsCreate(internals, decision);
    const result = await orchestrator.activatePlanRevision({
      commandId: 'cmd-1', expectedRevisionId: revisions.getActive().revisionId,
      commandType: 'REQUEST_SYNTHESIS', payload: {}, createdBy: 'human', timestamp: new Date().toISOString()
    }, { deferExecution: true });
    expect(result.ok).toBe(true);
    const state = orchestrator.getState();
    expect(state.stages.length).toBeGreaterThanOrEqual(stagesBefore);
    const staleOrCancelled = state.stages.filter((s) => ['stale', 'cancelled'].includes(s.status));
    expect(staleOrCancelled.length).toBeGreaterThan(0);
    expect(types(state)).toContain('PLAN_REVISION_ACTIVATED');
  });

  test('stale revision command is rejected without touching state', async () => {
    const { orchestrator } = makeOrchestrator();
    await orchestrator.startRun({ debateCase: makeCase(), deferExecution: true });
    const result = await orchestrator.activatePlanRevision({
      commandId: 'cmd-1', expectedRevisionId: 'rev-wrong',
      commandType: 'REQUEST_SYNTHESIS', payload: {}, createdBy: 'human', timestamp: new Date().toISOString()
    }, { deferExecution: true });
    expect(result.ok).toBe(false);
    expect(result.code).toBe('REVISION_STALE');
  });

  test.each([
    ['FINISH', undefined],
    ['CANCEL', 'CANCEL'],
    ['IGNORE_RESULT', 'IGNORE_RESULT'],
    ['CONVERT_TO_AUDIT', 'CONVERT_TO_AUDIT'],
    ['RESTART', 'RESTART']
  ])('running-stage policy %s has an explicit runtime disposition', async (policy, disposition) => {
    const { orchestrator, revisions } = makeOrchestrator();
    await orchestrator.startRun({
      debateCase: makeCase(),
      plannedStages: [{
        plannedStageId: 'p-running',
        purpose: 'verification',
        participantIds: ['alpha'],
        goalIds: ['g1']
      }],
      deferExecution: true
    });
    const revision = revisions.getActive();
    orchestrator._internals.state.stages.push({
      stageInstanceId: 'stage-running',
      plannedStageId: 'p-running',
      proposedStageId: 'proposed-running',
      runId: 'run-1',
      planRevisionId: revision.revisionId,
      status: 'running',
      purpose: 'verification',
      participants: [{ participantId: 'alpha', type: 'llm' }],
      goalIds: ['g1'],
      inputArtifactIds: ['claim:1'],
      dispatchMode: 'single',
      completionMode: 'all'
    });
    const result = await orchestrator.activatePlanRevision({
      commandId: `cmd-policy-${policy}`,
      expectedRevisionId: revision.revisionId,
      commandType: 'CHANGE_PRIORITY',
      payload: { plannedStageId: 'p-running', priority: 80, runningStagePolicy: policy },
      createdBy: 'human',
      timestamp: '2026-07-25T00:00:00.000Z'
    }, { deferExecution: true });
    expect(result.ok).toBe(true);
    const running = orchestrator._internals.state.stages.find((stage) => stage.stageInstanceId === 'stage-running');
    expect(running.resultDisposition).toBe(disposition);
    if (policy === 'RESTART') {
      expect(orchestrator._internals.state.stages).toEqual(expect.arrayContaining([
        expect.objectContaining({
          stageInstanceId: expect.stringContaining('stage-running:restart:'),
          status: 'pending',
          planRevisionId: result.revision.revisionId
        })
      ]));
    }
  });
});

// Helper: create stages from a decision through internals (test-only shortcut for
// producing a pending stage without executing it).
function internalsCreate(internals, decision) {
  const state = internals.state;
  for (const proposed of decision.proposedStages || []) {
    state.stages.push({
      stageInstanceId: `stage-test-${state.stages.length + 1}`,
      proposedStageId: proposed.proposedStageId,
      runId: state.runId,
      planRevisionId: decision.inputPlanRevisionId,
      createdByDecisionId: decision.decisionId,
      goalIds: proposed.goalIds,
      purpose: proposed.purpose,
      participants: proposed.participantIds.map((id) => ({ participantId: id, type: 'llm', model: id })),
      inputArtifactIds: proposed.inputArtifactIds,
      dispatchMode: proposed.dispatchMode,
      completionMode: proposed.completionMode,
      status: 'pending',
      attempt: 1
    });
  }
}
