// Automation Lab — restartable stage controller for the pilot (stages 1–5).
// State lives only in the store; the controller can be recreated at any point (page reload,
// crash) and continues from the persisted workflow state without re-calling accepted models.
(function initAlEngine(root) {
  'use strict';

  const Canonical = root.AlCanonical || require('./al-canonical.js');
  const Snapshot = root.AlSnapshot || require('./al-snapshot.js');
  const Compiler = root.AlPromptCompiler || require('./al-prompt-compiler.js');
  const Parser = root.AlResponseParser || require('./al-response-parser.js');
  const Validator = root.AlValidator || require('./al-validator.js');
  const Committer = root.AlCommitter || require('./al-committer.js');

  const ACTIVE_STATES = new Set(['READY', 'RUNNING', 'PAUSED']);

  function createEngine({ spec, store, transport, now = () => new Date().toISOString(), onUpdate = () => {}, log = () => {} }) {
    if (!spec.ok) throw new Error(`MANIFEST_LINT_FAILED: ${spec.problems.map((p) => `${p.code} ${p.detail}`).join('; ')}`);
    let running = null;
    let currentProjectId = null;
    let stopRequested = false;

    const tx = (mode, work) => store.transaction('*', mode, work);
    let diagCounter = 0;

    // Diagnostics journal: every orchestration and transport fact, so a problem can be
    // explained afterwards without guessing (see al-diagnostics.js).
    async function logDiag(projectId, event) {
      diagCounter += 1;
      const at = event.at || now();
      const record = { ...event, project_id: projectId, diag_id: `${String(Date.parse(at) || Date.now()).padStart(14, '0')}-${String(diagCounter).padStart(6, '0')}`, at };
      try { await tx('readwrite', (t) => t.put('diag', record)); } catch (_) { /* the journal never blocks the run */ }
      notify(projectId, 'diag');
    }
    const notify = (projectId, kind) => { try { onUpdate(projectId, kind); } catch (_) { /* UI errors never affect state */ } };

    async function createProject({ ideaText, title, models, primaryModel, timeoutMs, transportMode }) {
      const text = String(ideaText || '').trim();
      if (!text) throw new Error('IDEA_REQUIRED');
      const selected = [...new Set((models || []).filter(Boolean))];
      if (!selected.length) throw new Error('MODELS_REQUIRED');
      const at = now();
      const projectId = `PRJ-${Canonical.randomToken('', 10)}`;
      await tx('readwrite', async (t) => {
        const project = {
          project_id: projectId,
          title: String(title || text.split('\n')[0]).slice(0, 80),
          created_at: at,
          updated_at: at,
          spec_version: spec.version,
          revision: 1,
          counters: { IDEA: 1 },
          event_seq: 0,
          workflow_state: 'READY',
          next_stage: spec.pilotStages[0],
          wait: null,
          last_error: null,
          config: { models: selected, primary: selected.includes(primaryModel) ? primaryModel : selected[0], timeoutMs: Number(timeoutMs) || 600000, transport: transportMode || 'live' }
        };
        const payload = { raw_text: text, submitted_at: at, source_hash: Canonical.sha256Hex(text) };
        const idea = Committer.buildEntry(spec, {
          code: 'IDEA', object_id: 'IDEA-0001', version: 1, status: 'ACTIVE', blocking: false, authority_class: null,
          stage: 0, run: 'OWNER-INPUT', payload,
          provenance: { input_refs: [], stage_run_id: 'OWNER-INPUT', authority_refs: [], evidence_refs: [] }
        });
        await t.put('registry', { project_id: projectId, object_id: idea.object_id, version: 1, entry: idea });
        project.event_seq = 1;
        await t.put('events', { project_id: projectId, seq: 1, event: { event_id: 'EV-1', event_type: 'PROJECT_CREATED', project_id: projectId, project_revision: 1, at, run_id: null, payload: { idea: 'IDEA-0001', models: selected } } });
        await t.put('projects', project);
      });
      notify(projectId, 'created');
      return projectId;
    }

    async function listProjects() {
      return tx('readonly', async (t) => (await t.all('projects')).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    }

    async function getState(projectId) {
      return tx('readonly', async (t) => {
        const project = await t.get('projects', projectId);
        if (!project) return null;
        const records = await t.byProject('registry', projectId);
        const execs = (await t.byProject('execs', projectId)).sort((a, b) => a.seq - b.seq);
        const calls = await t.byProject('calls', projectId);
        const events = (await t.byProject('events', projectId)).sort((a, b) => a.seq - b.seq).map((item) => item.event);
        const diag = (await t.byProject('diag', projectId)).sort((a, b) => (a.diag_id < b.diag_id ? -1 : 1));
        return { project, records, latest: Snapshot.latestEntries(records), execs, calls, events, diag };
      });
    }

    async function updateProject(projectId, patch) {
      return tx('readwrite', async (t) => {
        const project = await t.get('projects', projectId);
        Object.assign(project, patch, { updated_at: now() });
        await t.put('projects', project);
        return project;
      });
    }

    async function setConfig(projectId, config) {
      const selected = [...new Set((config.models || []).filter(Boolean))];
      if (!selected.length) throw new Error('MODELS_REQUIRED');
      const project = await updateProject(projectId, {
        config: { models: selected, primary: selected.includes(config.primary) ? config.primary : selected[0], timeoutMs: Number(config.timeoutMs) || 600000, transport: config.transport || 'live' }
      });
      notify(projectId, 'config');
      return project;
    }

    function stateSummary(latest, project) {
      const counts = {};
      latest.forEach((entry) => { counts[`${entry.code}:${entry.status}`] = (counts[`${entry.code}:${entry.status}`] || 0) + 1; });
      return { workflow_state: project.workflow_state, next_stage: project.next_stage, objects: counts };
    }

    // ---- stage execution -------------------------------------------------------------------

    async function prepareExec(projectId, stageN) {
      return tx('readwrite', async (t) => {
        const project = await t.get('projects', projectId);
        const stage = spec.stage(stageN);
        const latest = Snapshot.latestEntries(await t.byProject('registry', projectId));
        const { entries, missing } = Snapshot.resolveInputs(stage, latest);
        if (missing.length) return { error: { code: 'STAGE_NOT_READY', message: `stage ${stageN} inputs missing: ${missing.join('; ')}` } };
        const snapshot = Snapshot.buildSnapshot({ projectId, stage, entries });
        const execs = await t.byProject('execs', projectId);
        const open = execs.find((exec) => exec.stage === stageN && exec.status === 'RUNNING');
        if (open && open.input_snapshot_hash === snapshot.input_snapshot_hash) return { execId: open.exec_id, resumed: true };
        if (open) { open.status = 'ABANDONED'; open.abandon_reason = 'snapshot changed'; await t.put('execs', open); }

        const fanout = stage.execution?.fanout;
        let models;
        if (fanout) {
          models = project.config.models.slice(0, fanout.max_runs);
          if (models.length < fanout.min_distinct_models) {
            return { error: { code: 'INDEPENDENCE_UNSATISFIED', message: `stage ${stageN} needs ${fanout.min_distinct_models} distinct models; ${models.length} selected` } };
          }
        } else {
          models = [project.config.primary || project.config.models[0]];
        }
        const seq = execs.length + 1;
        const execId = `EXEC-S${stageN}-${seq}-${Canonical.randomToken('', 6)}`;
        const deltaKeys = stageN === 1 ? [] : entries.filter((entry) => entry.created_stage === stageN - 1 || entry.version > 1).map((entry) => Snapshot.refKey(Snapshot.refOf(entry)));
        await t.put('snapshots', { ...snapshot, project_id: projectId, delta_keys: deltaKeys, summary: stateSummary(latest, project) });
        const callIds = [];
        for (const model of models) {
          const call = newCall({ projectId, execId, stageN, model });
          callIds.push(call.call_id);
          await t.put('calls', call);
        }
        await t.put('execs', {
          exec_id: execId, project_id: projectId, seq, stage: stageN, status: 'RUNNING', snapshot_id: snapshot.snapshot_id,
          input_snapshot_hash: snapshot.input_snapshot_hash, call_ids: callIds, failover_used: [], created_at: now()
        });
        return { execId, resumed: false };
      });
    }

    function newCall({ projectId, execId, stageN, model }) {
      return {
        call_id: `CALL-${Canonical.randomToken('', 10)}`,
        project_id: projectId,
        exec_id: execId,
        stage: stageN,
        model,
        call_token: Canonical.randomToken('C', 8),
        status: 'PENDING',
        fresh_attempts: 0,
        attempts: [],
        accepted: null
      };
    }

    function nextAttemptKind(call, stage) {
      const last = call.attempts[call.attempts.length - 1];
      const maxFresh = Number(stage.execution?.max_attempts || 3);
      const repairBudget = Number(stage.execution?.repair_attempts ?? spec.repairBudget());
      if (!last) return 'initial';
      if (last.outcome === 'REPAIRABLE') {
        const sinceFresh = [];
        for (let i = call.attempts.length - 1; i >= 0; i -= 1) {
          sinceFresh.push(call.attempts[i]);
          if (call.attempts[i].kind !== 'repair') break;
        }
        const repairsUsed = sinceFresh.filter((attempt) => attempt.kind === 'repair').length;
        if (repairsUsed < repairBudget) return 'repair';
      }
      if (last.outcome === 'INTERRUPTED' && call.fresh_attempts <= maxFresh) return 'fresh-retry';
      return call.fresh_attempts < maxFresh ? 'fresh' : null;
    }

    async function loadExecContext(execId) {
      return tx('readonly', async (t) => {
        const exec = await t.get('execs', execId);
        const snapshot = await t.get('snapshots', exec.snapshot_id);
        const calls = await Promise.all(exec.call_ids.map((id) => t.get('calls', id)));
        const project = await t.get('projects', exec.project_id);
        return { exec, snapshot, calls, project };
      });
    }

    async function saveCall(call, projectPatch) {
      await tx('readwrite', async (t) => {
        await t.put('calls', call);
        if (projectPatch) {
          const project = await t.get('projects', call.project_id);
          Object.assign(project, projectPatch, { updated_at: now() });
          await t.put('projects', project);
        }
      });
    }

    function buildAttempt(call, kind, stage, snapshot, project) {
      const attemptToken = Canonical.randomToken('A', 8);
      const tokens = { callToken: call.call_token, attemptToken };
      let compiled;
      if (kind === 'repair') {
        const previous = call.attempts[call.attempts.length - 1];
        const text = Compiler.compileRepair({ tokens, previousTokens: { attemptToken: previous.attempt_token }, errors: previous.errors });
        compiled = { ok: true, text, prompt_hash: Canonical.sha256Hex(text), chars: text.length, audit: { repair_of: previous.attempt_id } };
      } else {
        compiled = Compiler.compile({ spec, stage, snapshot, tokens, stateSummary: snapshot.summary, deltaKeys: snapshot.delta_keys });
      }
      return {
        attempt: {
          attempt_id: `${call.call_id}-A${call.attempts.length + 1}`,
          attempt_token: attemptToken,
          kind: kind === 'fresh-retry' ? 'fresh' : kind,
          prompt_text: compiled.ok ? compiled.text : null,
          prompt_hash: compiled.ok ? compiled.prompt_hash : null,
          prompt_chars: compiled.chars,
          context_audit: compiled.audit || null,
          status: 'DISPATCHED',
          dispatched_at: now(),
          model: call.model
        },
        compiled,
        tokens,
        projectConfig: project.config
      };
    }

    async function evaluate({ call, attempt, result, stage, snapshot, execId }) {
      attempt.finished_at = now();
      attempt.duration_ms = result?.durationMs ?? null;
      attempt.transport_status = result?.status || null;
      attempt.raw_text = result?.text ?? null;
      attempt.source_message_id = result?.sourceMessageId || null;
      if (!result || !result.ok) {
        attempt.outcome = result?.cancelled ? 'INTERRUPTED' : 'TRANSPORT_FAILED';
        attempt.errors = [{ class: 'TRANSPORT', code: result?.error || 'NO_RESULT', message: result?.errorMessage || result?.status || 'no terminal response' }];
        return;
      }
      const extracted = Parser.extract(result.text, { callToken: call.call_token, attemptToken: attempt.attempt_token });
      attempt.extraction_mode = extracted.ok ? extracted.mode : 'FAILED';
      if (!extracted.ok) {
        attempt.outcome = 'REPAIRABLE';
        attempt.parse_error = extracted.code;
        attempt.errors = [{ class: 'REPRESENTATION', code: extracted.code, message: extracted.detail || 'response frame/JSON could not be extracted deterministically' }];
        return;
      }
      if (extracted.controlCharsEscaped) attempt.json_control_chars_escaped = true;
      const sourceMessageId = result.sourceMessageId || `${call.model}:${Canonical.sha256Hex(result.text)}`;
      attempt.source_message_id = sourceMessageId;
      const duplicate = await tx('readonly', async (t) => {
        if (await t.get('messages', [call.project_id, sourceMessageId])) return true;
        const siblings = await t.byProject('calls', call.project_id);
        return siblings.some((other) => other.call_id !== call.call_id && other.accepted?.source_message_id === sourceMessageId);
      });
      if (duplicate) {
        attempt.outcome = 'TRANSPORT_FAILED';
        attempt.errors = [{ class: 'TRANSPORT', code: 'DUPLICATE_SOURCE_MESSAGE', message: 'this assistant message was already accepted for another call' }];
        return;
      }
      const validation = Validator.validateResponse({ spec, stage, snapshot, value: extracted.value, model: call.model });
      attempt.errors = validation.errors;
      attempt.anomalies = validation.anomalies || [];
      attempt.snapshot_hash_ack = extracted.value?.passport?.input_snapshot_hash === snapshot.input_snapshot_hash;
      if (validation.ok) {
        attempt.outcome = 'ACCEPTED';
        call.status = 'ACCEPTED';
        call.accepted = {
          attempt_id: attempt.attempt_id,
          source_message_id: sourceMessageId,
          extraction_mode: extracted.mode,
          canonical: extracted.value,
          canonical_hash: Canonical.hashJson(extracted.value),
          plan: validation.plan,
          exec_id: execId
        };
      } else {
        attempt.outcome = validation.errors.every((error) => error.class === 'REPRESENTATION') ? 'REPAIRABLE' : 'REJECTED';
      }
    }

    async function runExec(projectId, execId) {
      const stageN = (await loadExecContext(execId)).exec.stage;
      const stage = spec.stage(stageN);
      for (let round = 0; round < 40; round += 1) {
        if (stopRequested) return { stopped: true };
        const { exec, snapshot, calls, project } = await loadExecContext(execId);
        const pending = calls.filter((call) => call.status === 'PENDING');
        if (!pending.length) break;

        const repairs = [];
        const fresh = [];
        for (const call of pending) {
          const kind = nextAttemptKind(call, stage);
          if (!kind) {
            call.status = 'FAILED';
            await saveCall(call);
            if (!stage.execution?.fanout) {
              const nextModel = project.config.models.find((model) => !calls.some((other) => other.model === model) && !(exec.failover_used || []).includes(model));
              if (nextModel) {
                await tx('readwrite', async (t) => {
                  const failover = newCall({ projectId, execId, stageN, model: nextModel });
                  failover.failover_of = call.call_id;
                  const current = await t.get('execs', execId);
                  current.call_ids.push(failover.call_id);
                  current.failover_used = (current.failover_used || []).concat(nextModel);
                  await t.put('calls', failover);
                  await t.put('execs', current);
                });
                log(`stage ${stageN}: ${call.model} exhausted attempts, failover to ${nextModel}`);
              }
            }
            continue;
          }
          const built = buildAttempt(call, kind, stage, snapshot, project);
          if (!built.compiled.ok) {
            call.status = 'FAILED';
            call.attempts.push({ ...built.attempt, status: 'DONE', outcome: 'REJECTED', errors: [{ class: 'CONTEXT', code: built.compiled.code, message: `${built.compiled.chars} > ${built.compiled.limit}` }] });
            await saveCall(call);
            continue;
          }
          if (kind !== 'repair') call.fresh_attempts += 1;
          call.attempts.push(built.attempt);
          (kind === 'repair' ? repairs : fresh).push({ call, built });
        }
        if (!repairs.length && !fresh.length) continue;
        await tx('readwrite', async (t) => {
          for (const item of [...repairs, ...fresh]) await t.put('calls', item.call);
          const current = await t.get('projects', projectId);
          current.workflow_state = 'RUNNING';
          current.running_stage = stageN;
          await t.put('projects', current);
        });
        notify(projectId, 'dispatch');

        for (const [group, freshTabs] of [[repairs, false], [fresh, true]]) {
          if (!group.length || stopRequested) continue;
          // Each model's answer is validated and persisted the moment it arrives, so a page crash
          // in the middle of a fan-out batch never loses answers that were already accepted.
          // Evaluation is serialized: duplicate-message detection must see earlier acceptances.
          const byModel = new Map(group.map((item) => [item.call.model, item]));
          const handled = new Set();
          let chain = Promise.resolve();
          const handle = (model, result) => {
            const item = byModel.get(model);
            if (!item || handled.has(model)) return chain;
            handled.add(model);
            chain = chain.then(async () => {
              const { call, built } = item;
              const attempt = call.attempts[call.attempts.length - 1];
              attempt.status = 'DONE';
              await evaluate({ call, attempt, result, stage, snapshot, execId });
              if (attempt.outcome === 'INTERRUPTED' && stopRequested) call.fresh_attempts = Math.max(0, call.fresh_attempts - (built.attempt.kind === 'repair' ? 0 : 1));
              await saveCall(call);
              await logDiag(projectId, {
                source: 'engine', kind: 'ATTEMPT_RESULT', stage: stageN, exec_id: execId, call_id: call.call_id, model: call.model,
                attempt_id: attempt.attempt_id, attempt_kind: attempt.kind, outcome: attempt.outcome, extraction_mode: attempt.extraction_mode || null,
                transport_status: attempt.transport_status, duration_ms: attempt.duration_ms, response_chars: attempt.raw_text ? attempt.raw_text.length : 0,
                errors: (attempt.errors || []).slice(0, 8).map((error) => ({ class: error.class, code: error.code, message: String(error.message || '').slice(0, 300) }))
              });
              notify(projectId, 'attempt');
              log(`stage ${stageN} ${call.model} ${attempt.kind}: ${attempt.outcome}${attempt.errors?.length ? ` (${attempt.errors.slice(0, 3).map((e) => e.code).join(', ')})` : ''}`);
            });
            return chain;
          };
          const results = await transport.dispatch({
            calls: group.map(({ call, built }) => ({ model: call.model, prompt: built.attempt.prompt_text, tokens: built.tokens })),
            freshConversation: freshTabs,
            mode: project.config.transport || 'live',
            timeoutMs: project.config.timeoutMs,
            context: { pipelineRunId: execId, pipelineBatchId: `${execId}-R${round}-${freshTabs ? 'F' : 'R'}`, stageId: `AL-S${stageN}`, stageAttemptId: `${execId}:r${round}` },
            onResult: (model, result) => { void handle(model, result); },
            onEvent: (event) => { void logDiag(projectId, { source: 'transport', stage: stageN, exec_id: execId, round, ...event }); }
          });
          group.forEach(({ call }) => { void handle(call.model, results?.[call.model]); });
          await chain;
          notify(projectId, 'attempt');
        }
      }
      return { stopped: stopRequested };
    }

    async function failStage(projectId, stageN, execId, error) {
      await logDiag(projectId, { source: 'engine', kind: 'STAGE_FAILED', stage: stageN, exec_id: execId || null, code: error.code, message: error.message });
      await tx('readwrite', async (t) => {
        const project = await t.get('projects', projectId);
        if (execId) {
          const exec = await t.get('execs', execId);
          if (exec && exec.status === 'RUNNING') { exec.status = 'FAILED'; exec.failure = error; await t.put('execs', exec); }
        }
        project.workflow_state = 'STAGE_FAILED';
        project.last_error = { stage: stageN, ...error, at: now() };
        project.event_seq = (project.event_seq || 0) + 1;
        await t.put('events', { project_id: projectId, seq: project.event_seq, event: { event_id: `EV-${project.event_seq}`, event_type: 'STAGE_FAILED', project_id: projectId, project_revision: project.revision, at: now(), run_id: execId || null, payload: { stage: stageN, ...error } } });
        await t.put('projects', project);
      });
      notify(projectId, 'failed');
    }

    async function executeStage(projectId, stageN) {
      for (let conflictRetry = 0; conflictRetry < 2; conflictRetry += 1) {
        const prepared = await prepareExec(projectId, stageN);
        if (prepared.error) { await failStage(projectId, stageN, null, prepared.error); return false; }
        const { execId } = prepared;
        {
          const { calls: execCalls } = await loadExecContext(execId);
          const stage = spec.stage(stageN);
          await logDiag(projectId, {
            source: 'engine', kind: 'STAGE_STARTED', stage: stageN, exec_id: execId, resumed: prepared.resumed,
            mode: stage.execution?.fanout ? 'FANOUT' : 'SINGLE',
            models: execCalls.map((call) => call.model),
            already_accepted: execCalls.filter((call) => call.status === 'ACCEPTED').map((call) => call.model),
            min_distinct_models: stage.execution?.fanout?.min_distinct_models || 1
          });
        }
        const outcome = await runExec(projectId, execId);
        if (outcome.stopped) return false;
        const { calls } = await loadExecContext(execId);
        const accepted = calls.filter((call) => call.status === 'ACCEPTED');
        const need = spec.stage(stageN).execution?.fanout?.min_distinct_models || 1;
        if (new Set(accepted.map((call) => call.model)).size < need) {
          const reasons = calls.filter((call) => call.status === 'FAILED').map((call) => {
            const last = call.attempts[call.attempts.length - 1];
            return `${call.model}: ${(last?.errors || []).slice(0, 2).map((e) => e.code).join(', ') || last?.outcome || 'failed'}`;
          });
          await failStage(projectId, stageN, execId, { code: 'STAGE_ATTEMPTS_EXHAUSTED', message: `accepted ${accepted.length}/${need}. ${reasons.join(' | ')}` });
          return false;
        }
        try {
          const committed = await tx('readwrite', (t) => Committer.commitStageExec(t, { spec, projectId, execId, now: now() }));
          await logDiag(projectId, {
            source: 'engine', kind: 'STAGE_COMMITTED', stage: stageN, exec_id: execId,
            created: (committed.created || []).map((item) => `${item.ref.object_id}`), status_changes: (committed.statusChanges || []).length,
            next: { workflow_state: committed.project.workflow_state, next_stage: committed.project.next_stage, wait: committed.project.wait?.qst_ids || null }
          });
          notify(projectId, 'committed');
          log(`stage ${stageN} committed`);
          return true;
        } catch (error) {
          if (error.code === 'VERSION_CONFLICT' && conflictRetry === 0) {
            await tx('readwrite', async (t) => { const exec = await t.get('execs', execId); exec.status = 'ABANDONED'; exec.abandon_reason = error.message; await t.put('execs', exec); });
            continue;
          }
          await failStage(projectId, stageN, execId, { code: error.code || 'COMMIT_FAILED', message: error.message });
          return false;
        }
      }
      return false;
    }

    // options.untilStage: stop before executing that stage (step mode / fixtures).
    async function run(projectId, options = {}) {
      if (running) return running;
      currentProjectId = projectId;
      stopRequested = false;
      running = (async () => {
        try {
          for (let guard = 0; guard < 20; guard += 1) {
            const state = await getState(projectId);
            if (!state) throw new Error('PROJECT_NOT_FOUND');
            const { project } = state;
            if (!ACTIVE_STATES.has(project.workflow_state) || stopRequested) break;
            if (!spec.pilotStages.includes(project.next_stage)) break;
            if (options.untilStage && project.next_stage >= options.untilStage) break;
            const ok = await executeStage(projectId, project.next_stage);
            if (!ok || options.singleStage) break;
          }
        } finally {
          const state = await getState(projectId).catch(() => null);
          if (state?.project?.workflow_state === 'RUNNING') {
            await updateProject(projectId, { workflow_state: stopRequested ? 'PAUSED' : 'READY', running_stage: null });
          }
          running = null;
          notify(projectId, 'idle');
        }
      })();
      return running;
    }

    async function stop() {
      stopRequested = true;
      if (currentProjectId) await logDiag(currentProjectId, { source: 'engine', kind: 'STOP_REQUESTED' });
      await transport.cancel?.();
      return running;
    }

    async function answer(projectId, answers, ownerId) {
      const result = await tx('readwrite', (t) => Committer.compileAnswers(t, { spec, projectId, answers, now: now(), ownerId }));
      await logDiag(projectId, { source: 'engine', kind: 'OWNER_ANSWERED', applied: result.applied, next_stage: result.project.next_stage });
      notify(projectId, 'answered');
      return result;
    }

    async function retry(projectId) {
      const project = await updateProject(projectId, { workflow_state: 'READY', last_error: null });
      notify(projectId, 'retry');
      return project;
    }

    // Crash recovery: attempts left DISPATCHED by a dead page are INTERRUPTED; RUNNING projects
    // become PAUSED. Accepted-but-uncommitted calls are kept and committed on resume.
    async function recover() {
      const projects = await listProjects();
      for (const project of projects) {
        const interrupted = [];
        await tx('readwrite', async (t) => {
          const calls = await t.byProject('calls', project.project_id);
          for (const call of calls) {
            const last = call.attempts[call.attempts.length - 1];
            if (call.status === 'PENDING' && last && last.status === 'DISPATCHED') {
              last.status = 'DONE';
              last.outcome = 'INTERRUPTED';
              last.errors = [{ class: 'TRANSPORT', code: 'CONTROLLER_RESTARTED', message: 'page closed while waiting' }];
              last.finished_at = now();
              await t.put('calls', call);
              interrupted.push({ model: call.model, stage: call.stage });
            }
          }
          const current = await t.get('projects', project.project_id);
          if (current.workflow_state === 'RUNNING') { current.workflow_state = 'PAUSED'; current.running_stage = null; await t.put('projects', current); }
        });
        if (interrupted.length) await logDiag(project.project_id, { source: 'engine', kind: 'CONTROLLER_RESTARTED', interrupted });
      }
    }

    async function deleteProject(projectId) {
      await tx('readwrite', async (t) => {
        for (const storeName of ['registry', 'events', 'execs', 'calls', 'snapshots', 'messages', 'diag']) {
          const rows = await t.byProject(storeName, projectId);
          for (const row of rows) {
            const keyPath = root.AlStore?.STORES?.[storeName] || (typeof require !== 'undefined' ? require('./al-store.js').STORES[storeName] : null);
            const key = Array.isArray(keyPath) ? keyPath.map((field) => row[field]) : row[keyPath];
            await t.delete(storeName, key);
          }
        }
        await t.delete('projects', projectId);
      });
      notify(projectId, 'deleted');
    }

    return Object.freeze({ createProject, listProjects, getState, setConfig, run, stop, answer, retry, recover, deleteProject, isRunning: () => Boolean(running) });
  }

  const api = Object.freeze({ createEngine });
  root.AlEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
