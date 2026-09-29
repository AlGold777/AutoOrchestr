// Automation Lab — StateCommitter, Owner answer compiler and deterministic routing.
// The only module with canonical write access. Every function here runs inside one store
// transaction supplied by the caller; a thrown error aborts the whole transaction (zero mutations).
(function initAlCommitter(root) {
  'use strict';

  const Canonical = root.AlCanonical || require('./al-canonical.js');
  const Schema = root.AlSchema || require('./al-schema.js');
  const Snapshot = root.AlSnapshot || require('./al-snapshot.js');
  const Validator = root.AlValidator || require('./al-validator.js');

  class CommitError extends Error {
    constructor(code, message) { super(`${code}: ${message}`); this.code = code; }
  }

  const refOf = Snapshot.refOf;
  const refKey = Snapshot.refKey;

  function allocateId(project, code) {
    project.counters = project.counters || {};
    project.counters[code] = (project.counters[code] || 0) + 1;
    return `${code}-${String(project.counters[code]).padStart(4, '0')}`;
  }

  async function latestMap(tx, projectId) {
    const records = await tx.byProject('registry', projectId);
    const latest = new Map();
    records.forEach((record) => {
      const current = latest.get(record.object_id);
      if (!current || record.version > current.version) latest.set(record.object_id, record.entry);
    });
    return latest;
  }

  function buildEntry(spec, { code, object_id, version, status, blocking, authority_class, stage, run, payload, provenance, supersedes }) {
    const entry = {
      code,
      object_id,
      version,
      schema_version: spec.version,
      status,
      blocking: Boolean(blocking),
      authority_class: authority_class ?? null,
      created_stage: stage,
      created_by_run: run,
      payload,
      provenance: {
        input_refs: provenance.input_refs || [],
        stage_run_id: provenance.stage_run_id,
        authority_refs: provenance.authority_refs || [],
        evidence_refs: provenance.evidence_refs || []
      },
      stale: false,
      content_hash: Canonical.hashJson(payload)
    };
    if (supersedes) entry.supersedes = supersedes;
    const registryErrors = Schema.validate(spec.files.registryEntry, entry);
    if (registryErrors.length) throw new CommitError('REGISTRY_ENTRY_INVALID', `${object_id}@v${version}: ${Schema.formatErrors(registryErrors, 3).join('; ')}`);
    const payloadErrors = Schema.validate(spec.objectSchema(code), payload);
    if (payloadErrors.length) throw new CommitError('OBJECT_SCHEMA_INVALID', `${object_id}: ${Schema.formatErrors(payloadErrors, 3).join('; ')}`);
    if (!spec.hasStatus(code, status)) throw new CommitError('STATUS_INVALID', `${code}:${status}`);
    return entry;
  }

  function createWriter(tx, project, now) {
    const pending = [];
    return {
      async putEntry(entry) {
        pending.push(entry);
        await tx.put('registry', { project_id: project.project_id, object_id: entry.object_id, version: entry.version, entry });
      },
      async event(type, payload, runId = null) {
        project.event_seq = (project.event_seq || 0) + 1;
        const event = {
          event_id: `EV-${project.event_seq}`,
          event_type: type,
          project_id: project.project_id,
          project_revision: project.revision,
          at: now,
          run_id: runId,
          payload
        };
        await tx.put('events', { project_id: project.project_id, seq: project.event_seq, event });
        return event;
      },
      pending
    };
  }

  // New version of an existing entry with a changed status and/or payload (REVISE + SET_STATUS).
  function revise(spec, latest, { status, payload, stage, run, authorityRefs, inputRefs }) {
    return buildEntry(spec, {
      code: latest.code,
      object_id: latest.object_id,
      version: latest.version + 1,
      status: status || latest.status,
      blocking: latest.blocking,
      authority_class: latest.authority_class,
      stage,
      run,
      payload: payload || latest.payload,
      provenance: {
        input_refs: inputRefs || latest.provenance.input_refs,
        stage_run_id: run,
        authority_refs: authorityRefs || latest.provenance.authority_refs,
        evidence_refs: latest.provenance.evidence_refs
      },
      supersedes: refOf(latest)
    });
  }

  // Runtime-authored question, written in the language of the IDEA like every other owner-facing text.
  const DPL_APPROVAL_TEXT = {
    ru: {
      question: 'Утвердить Decision Policy (DPL), составленную на стадии 1? Она определяет, какие решения модели закрывают сами, а какие требуют вашего выбора.',
      approve: 'Утвердить и активировать Decision Policy',
      regenerate: 'Отклонить и пересоздать стадию 1'
    },
    en: {
      question: 'Approve the Decision Policy (DPL) drafted in stage 1? It defines which decisions models may close automatically and which ones require your selection.',
      approve: 'Approve and activate this Decision Policy',
      regenerate: 'Reject and regenerate stage 1'
    }
  };

  function dplApprovalQst(dpl, language = 'en') {
    const text = DPL_APPROVAL_TEXT[language] || DPL_APPROVAL_TEXT.en;
    return {
      session_id: 'DPL_APPROVAL',
      decision_ref: refOf(dpl),
      question: text.question,
      input_type: 'SINGLE',
      options: [
        { option_id: 'APPROVE', label: text.approve, semantic_value: 'APPROVE', effects: [{ effect_type: 'ACTIVATE_DPL', target: dpl.object_id, value: 'ACTIVE' }] },
        { option_id: 'REGENERATE', label: text.regenerate, semantic_value: 'REGENERATE', effects: [{ effect_type: 'RERUN_STAGE', target: dpl.object_id, value: 1 }] }
      ],
      when: true,
      required: true,
      authority_class: 'A3',
      blocking: true,
      default: null
    };
  }

  function nextRoute(stage, { requiredQsts }) {
    const routes = [].concat(stage.next?.on_success || []);
    for (const route of routes) {
      if (route.when === 'exists_visible_required_QST' && !requiredQsts.length) continue;
      if (route.action === 'WAIT') return { workflow_state: route.state, next_stage: route.resume_stage, wait: { qst_ids: requiredQsts, resume_stage: route.resume_stage } };
      if (route.action === 'RUN_STAGE') return { workflow_state: 'READY', next_stage: route.stage, wait: null };
    }
    return { workflow_state: 'READY', next_stage: stage.n + 1, wait: null };
  }

  function finalizeRoute(spec, project, route) {
    project.running_stage = null;
    const lastPilot = spec.pilotStages[spec.pilotStages.length - 1];
    if (route.workflow_state === 'READY' && route.next_stage > lastPilot) {
      project.workflow_state = 'PILOT_COMPLETE';
      project.next_stage = null;
      project.wait = null;
      return;
    }
    project.workflow_state = route.workflow_state;
    project.next_stage = route.next_stage;
    project.wait = route.wait;
  }

  // Fan-in commit of every accepted call of one stage execution, in deterministic call order.
  async function commitStageExec(tx, { spec, projectId, execId, now }) {
    const project = await tx.get('projects', projectId);
    const exec = await tx.get('execs', execId);
    if (!project || !exec) throw new CommitError('NOT_FOUND', `${projectId}/${execId}`);
    if (exec.status === 'COMMITTED') return { alreadyCommitted: true, project };
    const stage = spec.stage(exec.stage);
    const snapshot = await tx.get('snapshots', exec.snapshot_id);
    const calls = (await Promise.all(exec.call_ids.map((id) => tx.get('calls', id)))).filter((call) => call?.status === 'ACCEPTED');
    const need = stage.execution?.fanout?.min_distinct_models || 1;
    if (new Set(calls.map((call) => call.model)).size < need) throw new CommitError('INDEPENDENCE_UNSATISFIED', `stage ${stage.n} needs ${need} accepted models`);

    // Optimistic version check: every snapshot input is still the latest non-stale version.
    const latest = await latestMap(tx, projectId);
    snapshot.refs.forEach((ref) => {
      const current = latest.get(ref.object_id);
      if (!current || current.version !== ref.version || current.stale) throw new CommitError('VERSION_CONFLICT', `${refKey(ref)} changed after the snapshot was frozen`);
    });
    // Source-message idempotency across the whole project.
    for (const call of calls) {
      const seen = await tx.get('messages', [projectId, call.accepted.source_message_id]);
      if (seen && seen.call_id !== call.call_id) throw new CommitError('DUPLICATE_SOURCE_MESSAGE', call.accepted.source_message_id);
    }

    project.revision = (project.revision || 0) + 1;
    const writer = createWriter(tx, project, now);
    const dpl = [...latest.values()].find((entry) => entry.code === 'DPL' && entry.status === 'ACTIVE');
    const authorityRefs = dpl ? [refOf(dpl)] : [];
    const created = [];
    const statusChanges = [];
    const consequenceByKey = new Map();

    for (const call of calls) {
      const plan = call.accepted.plan;
      const tmpMap = {};
      plan.creates.forEach((item) => { tmpMap[item.temp_id] = { code: item.code, object_id: allocateId(project, item.code), version: 1 }; });
      for (const item of plan.creates) {
        const payload = Validator.mapRefs(item.payload, (ref) => (Validator.isTempRef(ref) ? { ...tmpMap[ref.temp_id] } : ref));
        // QST effect targets name the decision by temp_id; they become canonical IDs here.
        (payload.options || []).forEach((option) => (option.effects || []).forEach((effect) => {
          if (typeof effect.target === 'string' && tmpMap[effect.target]) effect.target = tmpMap[effect.target].object_id;
        }));
        (stage.contract.runtime_injected_fields?.[item.code] || []).forEach((field) => {
          if (field === 'source_model') payload.source_model = call.model;
          if (field === 'session_id') payload.session_id = `${exec.exec_id}:${call.model}`;
        });
        const target = tmpMap[item.temp_id];
        const entry = buildEntry(spec, {
          code: item.code,
          object_id: target.object_id,
          version: 1,
          status: item.status,
          blocking: item.blocking,
          authority_class: item.authority_class,
          stage: stage.n,
          run: call.call_id,
          payload,
          provenance: { input_refs: item.source_refs.length ? item.source_refs : snapshot.refs, stage_run_id: exec.exec_id, authority_refs: authorityRefs, evidence_refs: [] }
        });
        await writer.putEntry(entry);
        created.push({ ref: refOf(entry), status: entry.status, model: call.model, temp_id: item.temp_id, source_output_id: item.source_output_id });
      }
      plan.consequences.forEach((consequence) => {
        const key = refKey(consequence.ref);
        const prior = consequenceByKey.get(key);
        if (prior && prior.to_status !== consequence.to_status) throw new CommitError('DISPOSITION_CONFLICT_ACROSS_RUNS', key);
        consequenceByKey.set(key, consequence);
      });
      await tx.put('messages', { project_id: projectId, source_message_id: call.accepted.source_message_id, call_id: call.call_id, at: now });
      call.status = 'COMMITTED';
      call.tmp_map = tmpMap;
      await tx.put('calls', call);
    }

    for (const consequence of consequenceByKey.values()) {
      const current = latest.get(consequence.ref.object_id);
      const entry = revise(spec, current, { status: consequence.to_status, stage: stage.n, run: exec.exec_id, authorityRefs });
      await writer.putEntry(entry);
      statusChanges.push({ ref: refOf(entry), from: current.status, to: entry.status, reason: `disposition ${consequence.action}` });
    }

    // Runtime questionnaire (stage 1 → DPL_APPROVAL).
    const requiredQsts = created.filter((item) => item.ref.code === 'QST').map((item) => item.ref.object_id);
    if (stage.contract.runtime_questionnaire === 'DPL_APPROVAL') {
      const draft = writer.pending.find((entry) => entry.code === 'DPL');
      const qst = buildEntry(spec, {
        code: 'QST', object_id: allocateId(project, 'QST'), version: 1, status: 'READY', blocking: true, authority_class: 'A3',
        stage: stage.n, run: exec.exec_id, payload: dplApprovalQst(draft, /[а-яё]/i.test(String([...latest.values()].find((entry) => entry.code === 'IDEA')?.payload?.raw_text || '')) ? 'ru' : 'en'),
        provenance: { input_refs: [refOf(draft)], stage_run_id: exec.exec_id, authority_refs: [], evidence_refs: [] }
      });
      await writer.putEntry(qst);
      created.push({ ref: refOf(qst), status: 'READY', model: 'RUNTIME', temp_id: null });
      requiredQsts.push(qst.object_id);
    }

    exec.status = 'COMMITTED';
    exec.committed_at = now;
    exec.commit_revision = project.revision;
    await tx.put('execs', exec);
    await writer.event('STAGE_RUN_COMMITTED', {
      stage: stage.n,
      exec_id: exec.exec_id,
      snapshot_id: snapshot.snapshot_id,
      input_snapshot_hash: snapshot.input_snapshot_hash,
      calls: calls.map((call) => ({ call_id: call.call_id, model: call.model, source_message_id: call.accepted.source_message_id, tmp_map: call.tmp_map })),
      created: created.map((item) => ({ ...item.ref, status: item.status, model: item.model })),
      status_changes: statusChanges
    }, exec.exec_id);

    finalizeRoute(spec, project, nextRoute(stage, { requiredQsts }));
    project.last_error = null;
    project.updated_at = now;
    await writer.event('ROUTED', { from_stage: stage.n, workflow_state: project.workflow_state, next_stage: project.next_stage, wait: project.wait });
    await tx.put('projects', project);
    return { project, created, statusChanges };
  }

  // Deterministic answer compiler: selected option effects only, no model reinterpretation.
  async function compileAnswers(tx, { spec, projectId, answers, now, ownerId = 'owner' }) {
    const project = await tx.get('projects', projectId);
    if (!project || project.workflow_state !== 'WAITING_FOR_SELECTION' || !project.wait) throw new CommitError('NOT_WAITING', projectId);
    const latest = await latestMap(tx, projectId);
    const writer = createWriter(tx, project, now);
    project.revision += 1;
    let rerunStage = null;
    const applied = [];

    for (const qstId of project.wait.qst_ids) {
      const qst = latest.get(qstId);
      if (!qst || !['READY', 'ASKED'].includes(qst.status)) continue;
      const selected = answers[qstId];
      if (!Array.isArray(selected) || !selected.length) {
        if (qst.payload.required) throw new CommitError('ANSWER_REQUIRED', qstId);
        continue;
      }
      if (qst.payload.input_type === 'SINGLE' && selected.length !== 1) throw new CommitError('SINGLE_SELECTION', qstId);
      const options = selected.map((id) => qst.payload.options.find((option) => option.option_id === id));
      if (options.some((option) => !option)) throw new CommitError('UNKNOWN_OPTION', `${qstId}: ${selected.join(',')}`);

      const isPolicy = options.some((option) => option.effects.some((effect) => effect.effect_type === 'ACTIVATE_DPL'));
      const qans = buildEntry(spec, {
        code: 'QANS', object_id: allocateId(project, 'QANS'), version: 1, status: 'COMPILED', blocking: false, authority_class: qst.authority_class,
        stage: qst.created_stage, run: `ANSWER-${project.revision}`,
        payload: { question_ref: refOf(qst), selected_option_ids: selected.slice(), answered_at: now },
        provenance: { input_refs: [refOf(qst)], stage_run_id: `ANSWER-${project.revision}`, authority_refs: [], evidence_refs: [] }
      });
      await writer.putEntry(qans);
      const aev = buildEntry(spec, {
        code: 'AEV', object_id: allocateId(project, 'AEV'), version: 1, status: 'RECORDED', blocking: false, authority_class: qst.authority_class,
        stage: qst.created_stage, run: `ANSWER-${project.revision}`,
        payload: {
          actor_type: 'OWNER', actor_id: ownerId, action: isPolicy ? 'AUTHORIZE_POLICY' : 'QUESTIONNAIRE_ANSWER',
          subject_refs: [refOf(qst), refOf(qans)], authorization_scope: `${qst.object_id}:${selected.join(',')}`, occurred_at: now
        },
        provenance: { input_refs: [refOf(qst), refOf(qans)], stage_run_id: `ANSWER-${project.revision}`, authority_refs: [], evidence_refs: [] }
      });
      await writer.putEntry(aev);
      const authority = [refOf(aev)];
      const run = `ANSWER-${project.revision}`;

      for (const option of options) {
        for (const effect of option.effects) {
          const target = latest.get(effect.target);
          if (effect.effect_type === 'ACTIVATE_DPL' || effect.effect_type === 'RERUN_STAGE') {
            if (!target || target.code !== 'DPL') throw new CommitError('EFFECT_TARGET', `${effect.effect_type} -> ${effect.target}`);
            const entry = revise(spec, target, { status: effect.effect_type === 'ACTIVATE_DPL' ? 'ACTIVE' : 'SUPERSEDED', stage: qst.created_stage, run, authorityRefs: authority });
            await writer.putEntry(entry);
            latest.set(entry.object_id, entry);
            if (effect.effect_type === 'RERUN_STAGE') rerunStage = Number(effect.value) || 1;
          } else if (effect.effect_type === 'CLOSE_PD' || effect.effect_type === 'DEFER_PD') {
            if (!target || target.code !== 'PD') throw new CommitError('EFFECT_TARGET', `${effect.effect_type} -> ${effect.target}`);
            const closing = effect.effect_type === 'CLOSE_PD';
            const payload = {
              ...target.payload,
              decision: closing ? String(effect.value ?? option.label) : target.payload.decision ?? null,
              decided_by: closing ? 'OWNER_SELECTION' : 'DEFERRED',
              authorization_ref: authority[0]
            };
            const entry = revise(spec, target, { status: closing ? 'CLOSED' : 'DEFERRED', payload, stage: qst.created_stage, run, authorityRefs: authority });
            await writer.putEntry(entry);
            latest.set(entry.object_id, entry);
          } else if (effect.effect_type === 'CREATE_ASM') {
            const pdRef = qst.payload.decision_ref && latest.get(qst.payload.decision_ref.object_id);
            const asm = buildEntry(spec, {
              code: 'ASM', object_id: allocateId(project, 'ASM'), version: 1, status: 'UNVERIFIED', blocking: false, authority_class: null,
              stage: qst.created_stage, run,
              payload: { statement: String(effect.value), needed_evidence: 'Owner-stated assumption; verify before relying on it.', relied_on_by: pdRef ? [refOf(pdRef)] : [] },
              provenance: { input_refs: [refOf(qst)], stage_run_id: run, authority_refs: authority, evidence_refs: [] }
            });
            await writer.putEntry(asm);
          } else {
            throw new CommitError('EFFECT_UNSUPPORTED', effect.effect_type);
          }
          applied.push({ qst: qstId, option: option.option_id, effect: effect.effect_type, target: effect.target });
        }
      }
      const answered = revise(spec, latest.get(qstId), { status: 'ANSWERED', stage: qst.created_stage, run, authorityRefs: authority });
      await writer.putEntry(answered);
      latest.set(qstId, answered);
    }

    const stillOpen = project.wait.qst_ids.filter((id) => {
      const qst = latest.get(id);
      return qst && qst.payload.required && ['READY', 'ASKED'].includes(qst.status);
    });
    if (stillOpen.length) throw new CommitError('ANSWER_REQUIRED', stillOpen.join(', '));

    if (rerunStage) {
      // A regenerated stage replaces everything it produced before; nothing from the rejected run
      // may leak into the rerun snapshot.
      const rerun = spec.stage(rerunStage);
      for (const entry of [...latest.values()]) {
        if (entry.created_stage !== rerunStage || !(rerun.contract.creates || []).includes(entry.code)) continue;
        if (entry.status === 'SUPERSEDED' || !spec.hasStatus(entry.code, 'SUPERSEDED')) continue;
        const superseded = revise(spec, entry, { status: 'SUPERSEDED', stage: rerunStage, run: `ANSWER-${project.revision}` });
        await writer.putEntry(superseded);
        latest.set(entry.object_id, superseded);
      }
    }
    await writer.event('ANSWERS_COMPILED', { applied, answers }, null);
    if (rerunStage) {
      finalizeRoute(spec, project, { workflow_state: 'READY', next_stage: rerunStage, wait: null });
    } else {
      finalizeRoute(spec, project, { workflow_state: 'READY', next_stage: project.wait.resume_stage, wait: null });
    }
    project.updated_at = now;
    await writer.event('ROUTED', { workflow_state: project.workflow_state, next_stage: project.next_stage }, null);
    await tx.put('projects', project);
    return { project, applied };
  }

  const api = Object.freeze({ CommitError, commitStageExec, compileAnswers, buildEntry, allocateId, latestMap, dplApprovalQst, nextRoute });
  root.AlCommitter = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
