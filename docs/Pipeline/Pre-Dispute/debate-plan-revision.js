// Immutable Plan Revisions — the only mechanism for changing a Discussion Run's plan
// (Plan Revision Specification v1.0).
(function initDebatePlanRevision(root) {
  'use strict';

  const SCHEMA_VERSION = 1;

  const STATUS = Object.freeze({
    DRAFT: 'DRAFT',
    VALIDATED: 'VALIDATED',
    ACTIVE: 'ACTIVE',
    SUPERSEDED: 'SUPERSEDED',
    ARCHIVED: 'ARCHIVED'
  });

  const COMMANDS = Object.freeze([
    'INSERT_STAGE', 'REMOVE_PENDING_STAGE', 'CHANGE_STAGE_ORDER', 'CHANGE_PARTICIPANT',
    'CHANGE_VISIBILITY', 'CHANGE_EXECUTION_POLICY', 'CHANGE_COMPLETION_POLICY',
    'REQUEST_SYNTHESIS', 'REQUEST_AUDIT', 'INSERT_HUMAN_STAGE', 'ADD_CONSTRAINT',
    'REMOVE_CONSTRAINT', 'CHANGE_PRIORITY', 'SPLIT_STAGE', 'MERGE_STAGES',
    'CANCEL_GOAL', 'REOPEN_GOAL'
  ]);

  const RUNNING_STAGE_POLICIES = Object.freeze(['FINISH', 'CANCEL', 'IGNORE_RESULT', 'CONVERT_TO_AUDIT', 'RESTART']);

  const EVENTS = Object.freeze({
    REVISION_CREATED: 'REVISION_CREATED',
    REVISION_VALIDATED: 'REVISION_VALIDATED',
    REVISION_REJECTED: 'REVISION_REJECTED',
    REVISION_ACTIVATED: 'REVISION_ACTIVATED',
    REVISION_SUPERSEDED: 'REVISION_SUPERSEDED',
    REVISION_ARCHIVED: 'REVISION_ARCHIVED',
    REVISION_STALE: 'REVISION_STALE'
  });

  const INVALIDATION = Object.freeze({ UNCHANGED: 'UNCHANGED', STALE: 'STALE', CANCELLED: 'CANCELLED' });

  const deepFreeze = (value) => {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  };
  const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const canonicalize = (value) => {
    if (value === null) return 'null';
    if (typeof value === 'undefined') return 'undefined';
    if (typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  };
  const commandFingerprint = (command = {}) => canonicalize({
    commandId: command.commandId,
    expectedRevisionId: command.expectedRevisionId,
    commandType: command.commandType,
    payload: command.payload || {},
    createdBy: command.createdBy
  });

  // Semantic Stability Rules (§23): UI-only fields never require a revision.
  const UI_ONLY_FIELDS = Object.freeze(['zoom', 'position', 'color', 'collapsed', 'filters', 'sortOrder', 'localSettings']);
  const requiresRevision = (change = {}) => !UI_ONLY_FIELDS.includes(String(change.field || ''));

  function makeInitialRevision(seed = {}) {
    const revision = {
      schemaVersion: SCHEMA_VERSION,
      revisionId: String(seed.revisionId || `rev-${Date.now()}-0`),
      parentRevisionId: null,
      runId: String(seed.runId || ''),
      revisionNumber: 0,
      createdAt: seed.createdAt || nowIso(),
      createdBy: seed.createdBy || 'system',
      reason: seed.reason || 'initial_configuration',
      commands: [],
      executionPolicies: clone(seed.executionPolicies) || {},
      constraints: clone(seed.constraints) || [],
      plannedStages: clone(seed.plannedStages) || [],
      metadata: clone(seed.metadata) || {},
      plannerVersion: seed.plannerVersion || null,
      dependencyGraphVersion: 1,
      policyVersion: seed.policyVersion || 1,
      status: STATUS.ACTIVE
    };
    return deepFreeze(revision);
  }

  const invalid = (message, reasonCode) => ({ ok: false, code: 'SEMANTIC_INVALID', message, reasonCode });

  function graphErrors(stages = []) {
    const ids = new Set(stages.map((stage) => stage.plannedStageId));
    const errors = [];
    if (ids.size !== stages.length) errors.push({ reasonCode: 'PLANNED_STAGE_ID_DUPLICATE' });
    stages.forEach((stage) => (stage.upstream || []).forEach((upstreamId) => {
      if (!ids.has(upstreamId)) errors.push({ reasonCode: 'INVALID_INSERTION_POINT', plannedStageId: stage.plannedStageId, upstreamId });
      if (upstreamId === stage.plannedStageId) errors.push({ reasonCode: 'DEPENDENCY_CYCLE', plannedStageId: stage.plannedStageId, upstreamId });
    }));
    const visiting = new Set(); const visited = new Set();
    const visit = (stageId) => {
      if (visiting.has(stageId)) { errors.push({ reasonCode: 'DEPENDENCY_CYCLE', plannedStageId: stageId }); return; }
      if (visited.has(stageId)) return;
      visiting.add(stageId);
      const stage = stages.find((item) => item.plannedStageId === stageId);
      (stage?.upstream || []).forEach(visit);
      visiting.delete(stageId); visited.add(stageId);
    };
    stages.forEach((stage) => visit(stage.plannedStageId));
    return errors;
  }

  function validateCommand(command = {}, activeRevision, context = {}) {
    // Schema validation
    if (!command.commandId) return { ok: false, code: 'SCHEMA_INVALID', message: 'commandId required' };
    if (!COMMANDS.includes(command.commandType)) return { ok: false, code: 'SCHEMA_INVALID', message: `Unknown commandType: ${command.commandType}` };
    if (!command.createdBy) return { ok: false, code: 'SCHEMA_INVALID', message: 'createdBy required' };
    // Optimistic concurrency (§17)
    if (!command.expectedRevisionId) return { ok: false, code: 'SCHEMA_INVALID', message: 'expectedRevisionId required' };
    if (activeRevision && command.expectedRevisionId !== activeRevision.revisionId) {
      return { ok: false, code: 'REVISION_STALE', message: `expected ${command.expectedRevisionId}, active ${activeRevision.revisionId}` };
    }
    // Semantic validation
    const payload = command.payload || {};
    switch (command.commandType) {
      case 'INSERT_STAGE':
      case 'INSERT_HUMAN_STAGE': {
        if (!payload.stage || !payload.stage.purpose) return invalid('stage.purpose required', 'STAGE_PURPOSE_REQUIRED');
        const stage = payload.stage;
        if (stage.purpose === 'synthesis' && stage.assignmentPolicy === 'explicit_required'
          && !(stage.participantIds || []).length) return invalid('synthesis participant required', 'SYNTHESIS_PARTICIPANT_REQUIRED');
        if (payload.afterPlannedStageId && !(activeRevision?.plannedStages || []).some((item) => item.plannedStageId === payload.afterPlannedStageId)) {
          return invalid('afterPlannedStageId not found', 'INVALID_INSERTION_POINT');
        }
        if (stage.plannedStageId && (activeRevision?.plannedStages || []).some((item) => item.plannedStageId === stage.plannedStageId)) {
          return invalid('plannedStageId already exists', 'PLANNED_STAGE_ID_DUPLICATE');
        }
        break;
      }
      case 'REMOVE_PENDING_STAGE': {
        const target = (activeRevision?.plannedStages || []).find((s) => s.plannedStageId === payload.plannedStageId);
        if (!target) return invalid('plannedStageId not found', 'PLANNED_STAGE_NOT_FOUND');
        if (target.status && target.status !== 'pending') return invalid('only pending stages can be removed', 'STAGE_NOT_PENDING');
        if ((context.stageHistory || []).some((stage) => stage.plannedStageId === payload.plannedStageId && ['completed', 'running', 'awaiting_participant'].includes(stage.status))) {
          return invalid('completed or running stage cannot be removed', 'STAGE_NOT_FUTURE');
        }
        break;
      }
      case 'CHANGE_PARTICIPANT':
        if (!payload.stageId && !payload.fromParticipantId) return invalid('target stage or participant required', 'STAGE_TARGET_REQUIRED');
        if (!payload.toParticipantId) return invalid('toParticipantId required', 'PARTICIPANT_REQUIRED');
        if (payload.stageId && (context.stageHistory || []).some((stage) => stage.plannedStageId === payload.stageId && ['completed', 'running', 'awaiting_participant'].includes(stage.status))) {
          return invalid('completed or running stage cannot be changed', 'STAGE_NOT_FUTURE');
        }
        break;
      case 'CHANGE_STAGE_ORDER':
        if (!Array.isArray(payload.order) || !payload.order.length) return invalid('order required', 'ORDER_REQUIRED');
        if (new Set(payload.order).size !== payload.order.length) return invalid('order contains duplicate stage ids', 'ORDER_DUPLICATE');
        if (payload.order.some((stageId) => !(activeRevision?.plannedStages || []).some((stage) => stage.plannedStageId === stageId))) {
          return invalid('order contains unknown stage', 'PLANNED_STAGE_NOT_FOUND');
        }
        break;
      case 'ADD_CONSTRAINT':
        if (!payload.constraint) return invalid('constraint required', 'CONSTRAINT_REQUIRED');
        break;
      case 'MERGE_STAGES':
        if (!Array.isArray(payload.plannedStageIds) || payload.plannedStageIds.length < 2) {
          return invalid('MERGE_STAGES needs >= 2 stages', 'MERGE_STAGE_COUNT_INVALID');
        }
        break;
      default: break;
    }
    if (payload.runningStagePolicy && !RUNNING_STAGE_POLICIES.includes(payload.runningStagePolicy)) {
      return invalid(`Invalid runningStagePolicy: ${payload.runningStagePolicy}`, 'RUNNING_STAGE_POLICY_INVALID');
    }
    return { ok: true };
  }

  // §10 Conflict detection for a batch of commands applied together.
  function detectConflicts(commands = []) {
    const conflicts = [];
    const byStage = new Map();
    const byConstraint = new Map();
    const byPolicy = new Map();
    for (const command of commands) {
      const payload = command.payload || {};
      const stageKey = payload.plannedStageId || payload.stageId;
      if (stageKey) {
        if (byStage.has(stageKey)) conflicts.push({ code: 'STAGE_CONFLICT', stageId: stageKey, commands: [byStage.get(stageKey).commandId, command.commandId] });
        byStage.set(stageKey, command);
      }
      const constraintKey = payload.constraintId || payload.constraint?.constraintId;
      if (constraintKey) {
        if (byConstraint.has(constraintKey)) conflicts.push({ code: 'CONSTRAINT_CONFLICT', constraintId: constraintKey, commands: [byConstraint.get(constraintKey).commandId, command.commandId] });
        byConstraint.set(constraintKey, command);
      }
      if (payload.policyKey) {
        const previous = byPolicy.get(payload.policyKey);
        if (previous && JSON.stringify(previous.payload?.policyValue) !== JSON.stringify(payload.policyValue)) {
          conflicts.push({ code: 'POLICY_CONFLICT', policyKey: payload.policyKey, commands: [previous.commandId, command.commandId] });
        }
        byPolicy.set(payload.policyKey, command);
      }
    }
    return conflicts;
  }

  function applyCommand(draft, command) {
    const payload = clone(command.payload || {});
    const stages = draft.plannedStages;
    switch (command.commandType) {
      case 'INSERT_STAGE':
      case 'INSERT_HUMAN_STAGE': {
        const stage = {
          plannedStageId: payload.stage.plannedStageId || `planned-${draft.revisionNumber}-${stages.length}`,
          status: 'pending',
          upstream: payload.stage.upstream || [],
          downstream: payload.stage.downstream || [],
          goalIds: payload.stage.goalIds || [],
          artifactIds: payload.stage.artifactIds || [],
          ...payload.stage
        };
        if (command.commandType === 'INSERT_HUMAN_STAGE') stage.participantType = 'human';
        const afterIndex = payload.afterPlannedStageId
          ? stages.findIndex((item) => item.plannedStageId === payload.afterPlannedStageId)
          : -1;
        const index = afterIndex >= 0 ? afterIndex + 1 : (Number.isInteger(payload.index) ? payload.index : stages.length);
        if (afterIndex >= 0) {
          stage.upstream = Array.from(new Set([...(stage.upstream || []), payload.afterPlannedStageId]));
          stages.forEach((downstream) => {
            if (downstream.plannedStageId === stage.plannedStageId) return;
            if ((downstream.upstream || []).includes(payload.afterPlannedStageId)) {
              downstream.upstream = downstream.upstream.map((upstreamId) => upstreamId === payload.afterPlannedStageId ? stage.plannedStageId : upstreamId);
            }
          });
        }
        stages.splice(index, 0, stage);
        break;
      }
      case 'REMOVE_PENDING_STAGE': {
        const index = stages.findIndex((s) => s.plannedStageId === payload.plannedStageId);
        if (index >= 0) {
          const removed = stages[index];
          stages.forEach((downstream) => {
            if (!(downstream.upstream || []).includes(removed.plannedStageId)) return;
            downstream.upstream = Array.from(new Set([
              ...downstream.upstream.filter((upstreamId) => upstreamId !== removed.plannedStageId),
              ...(removed.upstream || [])
            ]));
          });
          stages.splice(index, 1);
        }
        break;
      }
      case 'CHANGE_STAGE_ORDER': {
        const ordered = (payload.order || []).map((id) => stages.find((s) => s.plannedStageId === id)).filter(Boolean);
        const rest = stages.filter((s) => !(payload.order || []).includes(s.plannedStageId));
        draft.plannedStages = [...ordered, ...rest];
        if (payload.rewireDependencies === 'linear') {
          draft.plannedStages.forEach((stage, index) => {
            stage.upstream = index ? [draft.plannedStages[index - 1].plannedStageId] : [];
          });
        }
        break;
      }
      case 'CHANGE_PARTICIPANT': {
        for (const stage of stages) {
          if (payload.stageId && stage.plannedStageId !== payload.stageId) continue;
          stage.participantIds = (stage.participantIds || []).map((id) => id === payload.fromParticipantId ? payload.toParticipantId : id);
          if (payload.stageId && !(stage.participantIds || []).includes(payload.toParticipantId)) {
            stage.participantIds = [...(stage.participantIds || []), payload.toParticipantId];
          }
        }
        break;
      }
      case 'CHANGE_VISIBILITY': draft.executionPolicies.visibility = payload.visibility; break;
      case 'CHANGE_EXECUTION_POLICY': draft.executionPolicies.execution = payload.policyValue ?? payload.execution; break;
      case 'CHANGE_COMPLETION_POLICY': draft.executionPolicies.completion = payload.policyValue ?? payload.completion; break;
      case 'REQUEST_SYNTHESIS':
        stages.push({ plannedStageId: payload.plannedStageId || `planned-synthesis-${draft.revisionNumber}`, purpose: 'synthesis', status: 'pending', participantIds: payload.participantIds || [], assignmentPolicy: payload.assignmentPolicy || 'planner_select', upstream: payload.upstream || [], goalIds: [] });
        break;
      case 'REQUEST_AUDIT':
        stages.push({ plannedStageId: payload.plannedStageId || `planned-audit-${draft.revisionNumber}`, purpose: 'audit', status: 'pending', participantIds: payload.participantIds || [], upstream: payload.upstream || [], goalIds: [] });
        break;
      case 'ADD_CONSTRAINT':
        draft.constraints.push({ constraintId: payload.constraint.constraintId || `constraint-${draft.constraints.length}`, ...payload.constraint });
        break;
      case 'REMOVE_CONSTRAINT':
        draft.constraints = draft.constraints.filter((c) => c.constraintId !== payload.constraintId);
        break;
      case 'CHANGE_PRIORITY': {
        const stage = stages.find((s) => s.plannedStageId === payload.plannedStageId);
        if (stage) stage.priority = payload.priority;
        break;
      }
      case 'SPLIT_STAGE': {
        const index = stages.findIndex((s) => s.plannedStageId === payload.plannedStageId);
        if (index >= 0) {
          const source = stages[index];
          const parts = (payload.parts || []).map((part, i) => ({ ...clone(source), ...part, plannedStageId: part.plannedStageId || `${source.plannedStageId}:part${i + 1}` }));
          stages.splice(index, 1, ...parts);
        }
        break;
      }
      case 'MERGE_STAGES': {
        const merged = stages.filter((s) => payload.plannedStageIds.includes(s.plannedStageId));
        if (merged.length >= 2) {
          const target = {
            ...clone(merged[0]),
            plannedStageId: payload.mergedStageId || `merged-${draft.revisionNumber}`,
            participantIds: Array.from(new Set(merged.flatMap((s) => s.participantIds || []))),
            goalIds: Array.from(new Set(merged.flatMap((s) => s.goalIds || []))),
            upstream: Array.from(new Set(merged.flatMap((s) => s.upstream || []))).filter((id) => !payload.plannedStageIds.includes(id))
          };
          const firstIndex = stages.findIndex((s) => s.plannedStageId === merged[0].plannedStageId);
          draft.plannedStages = stages.filter((s) => !payload.plannedStageIds.includes(s.plannedStageId));
          draft.plannedStages.splice(firstIndex, 0, target);
        }
        break;
      }
      case 'CANCEL_GOAL':
        draft.metadata.cancelledGoalIds = Array.from(new Set([...(draft.metadata.cancelledGoalIds || []), payload.goalId]));
        draft.metadata.reopenedGoalIds = (draft.metadata.reopenedGoalIds || []).filter((id) => id !== payload.goalId);
        break;
      case 'REOPEN_GOAL':
        draft.metadata.reopenedGoalIds = Array.from(new Set([...(draft.metadata.reopenedGoalIds || []), payload.goalId]));
        draft.metadata.cancelledGoalIds = (draft.metadata.cancelledGoalIds || []).filter((id) => id !== payload.goalId);
        break;
      default: break;
    }
    return draft;
  }

  // §12–§13 Dependency graph + closure over planned stages.
  function dependencyClosure(revision, changedStageIds = [], changedGoalIds = []) {
    const stages = revision.plannedStages || [];
    const affected = new Set(changedStageIds);
    for (const stage of stages) {
      if ((stage.goalIds || []).some((id) => changedGoalIds.includes(id))) affected.add(stage.plannedStageId);
    }
    let grew = true;
    while (grew) {
      grew = false;
      for (const stage of stages) {
        if (affected.has(stage.plannedStageId)) continue;
        if ((stage.upstream || []).some((id) => affected.has(id))) { affected.add(stage.plannedStageId); grew = true; }
      }
    }
    return Array.from(affected);
  }

  // §14 Stage invalidation for active StageInstances tied to superseded revisions.
  function invalidateStages(activeStages = [], newRevision, affectedStageIds = []) {
    const plannedIds = new Set((newRevision.plannedStages || []).map((s) => s.plannedStageId));
    return activeStages.map((stage) => {
      const linkedPlannedId = stage.plannedStageId || stage.stageInstanceId;
      if (stage.status === 'pending' && !plannedIds.has(linkedPlannedId)) {
        return { stageInstanceId: stage.stageInstanceId, invalidation: INVALIDATION.CANCELLED };
      }
      if (affectedStageIds.includes(linkedPlannedId)) {
        return { stageInstanceId: stage.stageInstanceId, invalidation: INVALIDATION.STALE };
      }
      return { stageInstanceId: stage.stageInstanceId, invalidation: INVALIDATION.UNCHANGED };
    });
  }

  function createRevisionStore(options = {}) {
    const emit = typeof options.emit === 'function' ? options.emit : () => {};
    const persist = typeof options.persist === 'function' ? options.persist : () => {};
    const revisions = [];
    const commandLedger = new Map();
    let active = null;

    const persistState = () => persist(revisions.slice(), active, Array.from(commandLedger.values()).map(clone));
    const replayResult = (record) => ({
      ok: true,
      replayed: true,
      commandId: record.commandId,
      revision: revisions.find((revision) => revision.revisionId === record.revisionId) || null,
      affectedStageIds: record.affectedStageIds || [],
      stageInvalidation: record.stageInvalidation || [],
      runningStagePolicy: record.runningStagePolicy || 'FINISH'
    });

    const trace = (revision, commands, affected) => ({
      runId: revision.runId,
      revisionId: revision.revisionId,
      parentRevisionId: revision.parentRevisionId,
      revisionNumber: revision.revisionNumber,
      createdBy: revision.createdBy,
      commands: commands.map((c) => c.commandType),
      affectedStages: affected,
      affectedGoals: commands.flatMap((c) => [c.payload?.goalId]).filter(Boolean),
      dependencyClosure: affected,
      plannerVersion: revision.plannerVersion,
      timestamp: revision.createdAt
    });

    const store = {
      initialize(seed = {}) {
        active = makeInitialRevision(seed);
        revisions.push(active);
        persistState();
        emit(EVENTS.REVISION_ACTIVATED, { revisionId: active.revisionId, revisionNumber: 0 });
        return active;
      },
      getActive: () => active,
      getLineage: () => revisions.slice(),
      getById: (revisionId) => revisions.find((r) => r.revisionId === revisionId) || null,

      // §9/§11 Atomic revision creation from one or more commands.
      submit(commandOrCommands, context = {}) {
        const commands = Array.isArray(commandOrCommands) ? commandOrCommands : [commandOrCommands];
        if (!active) throw new Error('Revision store is not initialized');
        const known = commands.map((command) => ({ command, record: commandLedger.get(String(command?.commandId || '')) }));
        if (known.some((entry) => entry.record)) {
          const mismatched = known.find((entry) => entry.record && entry.record.fingerprint !== commandFingerprint(entry.command));
          if (mismatched) return { ok: false, code: 'COMMAND_ID_CONFLICT', commandId: mismatched.command.commandId };
          if (known.every((entry) => entry.record)) return replayResult(known[0].record);
          return { ok: false, code: 'COMMAND_ID_REPLAY_MIXED' };
        }
        for (const command of commands) {
          const verdict = validateCommand(command, active, context);
          if (!verdict.ok) {
            emit(verdict.code === 'REVISION_STALE' ? EVENTS.REVISION_STALE : EVENTS.REVISION_REJECTED,
              { commandId: command.commandId, code: verdict.code, message: verdict.message });
            return { ok: false, code: verdict.code, reasonCode: verdict.reasonCode, message: verdict.message, commandId: command.commandId };
          }
        }
        const conflicts = detectConflicts(commands);
        if (conflicts.length) {
          emit(EVENTS.REVISION_REJECTED, { code: 'COMMAND_CONFLICT', conflicts });
          return { ok: false, code: 'COMMAND_CONFLICT', conflicts };
        }
        if (typeof options.validateDraft === 'function') {
          // Capability/Policy/Budget validation hook (§9): delegated to the injected contract.
          const draftCheck = options.validateDraft(commands, active, context);
          if (draftCheck && draftCheck.valid === false) {
            emit(EVENTS.REVISION_REJECTED, { code: 'POLICY_INVALID', errors: draftCheck.errors });
            return { ok: false, code: 'POLICY_INVALID', errors: draftCheck.errors };
          }
        }
        const draft = {
          ...clone(active),
          revisionId: context.revisionId || `rev-${Date.now()}-${active.revisionNumber + 1}`,
          parentRevisionId: active.revisionId,
          revisionNumber: active.revisionNumber + 1,
          createdAt: nowIso(),
          createdBy: commands[0].createdBy,
          reason: context.reason || commands.map((c) => c.commandType).join('+'),
          commands: commands.map((c) => clone(c)),
          dependencyGraphVersion: (active.dependencyGraphVersion || 1) + 1,
          status: STATUS.DRAFT
        };
        try {
          commands.forEach((command) => applyCommand(draft, command));
        } catch (error) {
          emit(EVENTS.REVISION_REJECTED, { code: 'APPLY_FAILED', message: error?.message });
          return { ok: false, code: 'APPLY_FAILED', message: error?.message };
        }
        const graphValidation = graphErrors(draft.plannedStages || []);
        if (graphValidation.length) {
          emit(EVENTS.REVISION_REJECTED, { code: 'SEMANTIC_INVALID', reasonCode: graphValidation[0].reasonCode, errors: graphValidation });
          return { ok: false, code: 'SEMANTIC_INVALID', reasonCode: graphValidation[0].reasonCode, errors: graphValidation };
        }
        emit(EVENTS.REVISION_CREATED, { revisionId: draft.revisionId, parentRevisionId: draft.parentRevisionId });
        draft.status = STATUS.VALIDATED;
        emit(EVENTS.REVISION_VALIDATED, { revisionId: draft.revisionId });

        const changedStageIds = commands.map((c) => c.payload?.plannedStageId || c.payload?.stageId).filter(Boolean);
        const changedGoalIds = commands.map((c) => c.payload?.goalId).filter(Boolean);
        const affected = dependencyClosure(draft, changedStageIds, changedGoalIds);

        const previous = active;
        const activated = deepFreeze({ ...draft, status: STATUS.ACTIVE });
        const supersededIndex = revisions.findIndex((r) => r.revisionId === previous.revisionId);
        revisions[supersededIndex] = deepFreeze({ ...clone(previous), status: STATUS.SUPERSEDED });
        revisions.push(activated);
        active = activated;
        const result = { ok: true, revision: activated, affectedStageIds: affected, stageInvalidation: invalidateStages(context.activeStages || [], activated, affected), runningStagePolicy: commands.find((c) => c.payload?.runningStagePolicy)?.payload?.runningStagePolicy || 'FINISH' };
        commands.forEach((command) => commandLedger.set(String(command.commandId), {
          commandId: String(command.commandId), fingerprint: commandFingerprint(command), revisionId: activated.revisionId,
          affectedStageIds: result.affectedStageIds, stageInvalidation: result.stageInvalidation,
          runningStagePolicy: result.runningStagePolicy
        }));
        persistState();
        emit(EVENTS.REVISION_SUPERSEDED, { revisionId: previous.revisionId });
        emit(EVENTS.REVISION_ACTIVATED, { revisionId: activated.revisionId, revisionNumber: activated.revisionNumber, trace: trace(activated, commands, affected) });
        return result;
      },

      archive(revisionId) {
        const index = revisions.findIndex((r) => r.revisionId === revisionId);
        if (index < 0 || revisions[index].status === STATUS.ACTIVE) return false;
        revisions[index] = deepFreeze({ ...clone(revisions[index]), status: STATUS.ARCHIVED });
        persistState();
        emit(EVENTS.REVISION_ARCHIVED, { revisionId });
        return true;
      },

      // §27 Recovery restores active revision + lineage.
      hydrate(persisted = {}) {
        revisions.length = 0;
        (persisted.revisions || []).forEach((r) => revisions.push(deepFreeze(clone(r))));
        commandLedger.clear();
        (persisted.commandLedger || []).forEach((record) => {
          if (record?.commandId && record?.fingerprint && record?.revisionId) commandLedger.set(String(record.commandId), clone(record));
        });
        active = revisions.find((r) => r.status === STATUS.ACTIVE) || null;
        return active;
      },
      getCommandLedger: () => Array.from(commandLedger.values()).map(clone)
    };
    return store;
  }

  const api = Object.freeze({
    SCHEMA_VERSION, STATUS, COMMANDS, EVENTS, INVALIDATION, RUNNING_STAGE_POLICIES,
    requiresRevision, makeInitialRevision, validateCommand, detectConflicts, commandFingerprint, graphErrors,
    dependencyClosure, invalidateStages, createRevisionStore
  });
  root.DebatePlanRevision = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
