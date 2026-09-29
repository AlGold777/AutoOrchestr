// Automation Lab — AL-STRUCT-1 validation pipeline + deterministic Policy Engine for one call.
// Produces either typed errors (REPRESENTATION → one same-conversation repair; SEMANTIC → fresh
// attempt) or a normalized commit plan. Nothing here writes state.
(function initAlValidator(root) {
  'use strict';

  const Schema = root.AlSchema || require('./al-schema.js');
  const Snapshot = root.AlSnapshot || require('./al-snapshot.js');

  const RESERVED_PAYLOAD_KEYS = ['object_id', 'version', 'status', 'blocking', 'authority_class', 'content_hash', 'created_by_run',
    'created_stage', 'provenance', 'stale', 'schema_version', 'run_id', 'input_snapshot_hash', 'call_id', 'attempt_id'];
  const BOOTSTRAP_MODES = { A0: 'AUTO_POLICY', A1: 'REQUIRE_EVIDENCE', A2: 'REQUIRE_OWNER_SELECTION', A3: 'REQUIRE_OWNER_SELECTION', A4: 'PROHIBITED' };

  const isObj = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isTempRef = (value) => isObj(value) && typeof value.temp_id === 'string' && typeof value.code === 'string'
    && Object.keys(value).every((key) => key === 'code' || key === 'temp_id');
  const isObjectRef = (value) => isObj(value) && typeof value.object_id === 'string' && typeof value.code === 'string'
    && Number.isInteger(value.version) && Object.keys(value).length === 3;

  function walkRefs(value, visit, path = '') {
    if (Array.isArray(value)) value.forEach((item, index) => walkRefs(item, visit, `${path}[${index}]`));
    else if (isObj(value)) {
      if (isTempRef(value) || isObjectRef(value)) { visit(value, path); return; }
      Object.entries(value).forEach(([key, item]) => walkRefs(item, visit, path ? `${path}.${key}` : key));
    }
  }

  function mapRefs(value, fn) {
    if (Array.isArray(value)) return value.map((item) => mapRefs(item, fn));
    if (isObj(value)) {
      if (isTempRef(value) || isObjectRef(value)) return fn(value);
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapRefs(item, fn)]));
    }
    return value;
  }

  // Decision Policy mode for an authority class: ACTIVE DPL rules, else bootstrapDecisionPolicy.
  function policyMode(dplPayload, authorityClass, decisionKind) {
    const rules = Array.isArray(dplPayload?.authority_rules) ? dplPayload.authority_rules : [];
    const forClass = rules.filter((rule) => rule.authority_class === authorityClass);
    const specific = decisionKind ? forClass.find((rule) => (rule.decision_kinds || []).includes(decisionKind)) : null;
    const rule = specific || forClass[0];
    if (!rule) return BOOTSTRAP_MODES[authorityClass] || 'PROHIBITED';
    // A DPL can never widen authority beyond the framework ladder: A2/A3 always need the Owner, A4 is never allowed.
    if (authorityClass === 'A4') return 'PROHIBITED';
    if ((authorityClass === 'A2' || authorityClass === 'A3') && rule.mode === 'AUTO_POLICY') return 'REQUIRE_OWNER_SELECTION';
    return rule.mode;
  }

  function validateResponse({ spec, stage, snapshot, value, model }) {
    const errors = [];
    const anomalies = [];
    const err = (cls, code, message) => errors.push({ class: cls, code, message });
    const R = (code, message) => err('REPRESENTATION', code, message);
    const S = (code, message) => err('SEMANTIC', code, message);

    // 0. deterministic key normalization: a bare "<object_id>" of a snapshot input becomes its
    //    canonical input key "<object_id>@v<version>" (recorded as an anomaly, never guessed).
    const bareIds = new Map(snapshot.refs.map((ref) => [ref.object_id, Snapshot.refKey(ref)]));
    if (Array.isArray(value?.input_fate)) {
      value.input_fate.forEach((fate) => {
        if (fate && bareIds.has(fate.input_id)) { anomalies.push(`input_fate ${fate.input_id} -> ${bareIds.get(fate.input_id)}`); fate.input_id = bareIds.get(fate.input_id); }
      });
    }
    if (Array.isArray(value?.trace)) {
      value.trace.forEach((entry) => {
        if (Array.isArray(entry?.source_ids)) entry.source_ids = entry.source_ids.map((id) => (bareIds.has(id) ? bareIds.get(id) : id));
      });
    }

    // 1. full AL-STRUCT-1 schema (validator-side source of truth)
    const schemaErrors = Schema.validate(spec.files.alSchema, value);
    if (schemaErrors.length) {
      Schema.formatErrors(schemaErrors, 20).forEach((message) => R('AL_STRUCT_SCHEMA', message));
      return { ok: false, errors, anomalies };
    }

    const contract = stage.contract || {};
    const rc = stage.response_contract || {};
    const passport = value.passport;
    const inputKeys = new Map(snapshot.refs.map((ref) => [Snapshot.refKey(ref), ref]));
    const inputIds = new Map(snapshot.refs.map((ref) => [ref.object_id, ref]));
    const snapshotItems = new Map(snapshot.items.map((item) => [item.ref.object_id, item]));

    // 2. passport / snapshot acknowledgement / reference-first
    if (Number(passport.stage) !== stage.n) R('PASSPORT_STAGE_MISMATCH', `passport.stage=${passport.stage}, expected ${stage.n}`);
    if (passport.input_snapshot_id !== snapshot.snapshot_id) R('SNAPSHOT_ID_MISMATCH', `expected ${snapshot.snapshot_id}`);
    if (passport.input_snapshot_hash !== snapshot.input_snapshot_hash) R('SNAPSHOT_HASH_MISMATCH', `expected ${snapshot.input_snapshot_hash}`);
    passport.input_refs.forEach((ref) => {
      if (!inputKeys.has(Snapshot.refKey(ref)) || inputKeys.get(Snapshot.refKey(ref)).code !== ref.code) {
        R('CANONICAL_ID_INVENTION', `passport.input_refs contains ${Snapshot.refKey(ref)} which is not in the snapshot`);
      }
    });

    // 3. internal consistency
    const outputIds = value.outputs.map((output) => output.id);
    const outputSet = new Set(outputIds);
    if (outputSet.size !== outputIds.length) R('OUTPUT_ID_DUPLICATE', 'outputs[].id must be unique');
    const completion = value.completion;
    if (completion.output_count !== value.outputs.length) R('OUTPUT_COUNT_MISMATCH', `completion.output_count=${completion.output_count}, outputs=${value.outputs.length}`);
    const declared = new Set(completion.output_ids);
    if (declared.size !== outputSet.size || [...declared].some((id) => !outputSet.has(id))) R('OUTPUT_IDS_MISMATCH', 'completion.output_ids must equal the set of outputs[].id');
    const tempIds = new Map();
    value.changes.forEach((change, index) => {
      if (!change.temp_id) return;
      if (tempIds.has(change.temp_id)) R('TEMP_ID_DUPLICATE', `changes[${index}].temp_id ${change.temp_id}`);
      tempIds.set(change.temp_id, change);
    });
    const normalizeSourceId = (id) => {
      if (inputKeys.has(id) || outputSet.has(id) || tempIds.has(id)) return id;
      if (inputIds.has(id)) { anomalies.push(`trace source ${id} normalized to ${Snapshot.refKey(inputIds.get(id))}`); return Snapshot.refKey(inputIds.get(id)); }
      return null;
    };
    value.trace.forEach((entry) => {
      if (!outputSet.has(entry.output_id)) R('TRACE_OUTPUT_UNKNOWN', `trace.output_id ${entry.output_id}`);
      entry.source_ids.forEach((id) => { if (!normalizeSourceId(id)) R('TRACE_SOURCE_UNKNOWN', `trace.source_ids ${id} is not an input key, output id or temp_id`); });
    });
    const fateByInput = new Map();
    value.input_fate.forEach((fate) => {
      if (!inputKeys.has(fate.input_id) && inputIds.has(fate.input_id)) {
        anomalies.push(`input_fate ${fate.input_id} normalized to ${Snapshot.refKey(inputIds.get(fate.input_id))}`);
        fate.input_id = Snapshot.refKey(inputIds.get(fate.input_id));
      }
      if (!inputKeys.has(fate.input_id)) R('INPUT_FATE_UNKNOWN', `input_fate.input_id ${fate.input_id} is not in passport.input_refs`);
      if (fateByInput.has(fate.input_id)) R('INPUT_FATE_DUPLICATE', fate.input_id);
      fateByInput.set(fate.input_id, fate);
      fate.output_ids.forEach((id) => { if (!outputSet.has(id)) R('INPUT_FATE_OUTPUT_UNKNOWN', `${fate.input_id} -> ${id}`); });
    });

    // 4. empty result policy
    if (completion.empty_by_design) {
      if (!rc.allows_empty_by_design) S('EMPTY_NOT_ALLOWED', `stage ${stage.n} requires material output`);
      if (value.changes.length) R('EMPTY_WITH_CHANGES', 'empty_by_design=true requires changes=[]');
    } else if (!value.outputs.length) {
      R('NO_GLOBAL_NO_CHANGE', 'outputs is empty but empty_by_design is false');
    }
    if (rc.requires_material_output && !value.changes.length) S('MATERIAL_OUTPUT_REQUIRED', `stage ${stage.n} must create objects`);
    if (completion.status === 'FAILED') S('MODEL_REPORTED_FAILED', (completion.anomalies || []).join('; ') || 'completion.status FAILED');
    if (completion.status === 'PARTIAL') anomalies.push(`model reported PARTIAL: ${(completion.anomalies || []).join('; ')}`);

    // 5. changes: permissions, lineage, payloads
    const creates = new Set(contract.creates || []);
    const injected = contract.runtime_injected_fields || {};
    const plan = [];
    value.changes.forEach((change, index) => {
      const at = `changes[${index}] ${change.op} ${change.object_type}`;
      if (!outputSet.has(change.source_output_id)) R('CHANGE_OUTPUT_UNKNOWN', `${at}: source_output_id ${change.source_output_id}`);
      if (change.op === 'UPDATE' || change.op === 'SUPERSEDE') {
        S('OP_NOT_ALLOWED', `${at}: stage ${stage.n} changes inputs only through runtime-owned status consequences`);
        return;
      }
      if (!creates.has(change.object_type)) { S('MUTATION_NOT_PERMITTED', `${at}: stage ${stage.n} may create ${[...creates].join(', ')}`); return; }
      if (change.op === 'MERGE' && !creates.has('PD')) { S('OP_NOT_ALLOWED', `${at}: MERGE is only used by transformation stages`); return; }
      (change.source_refs || []).forEach((ref) => {
        if (!inputKeys.has(Snapshot.refKey(ref))) R('SOURCE_REF_NOT_IN_SNAPSHOT', `${at}: ${Snapshot.refKey(ref)}`);
      });
      const payload = isObj(change.payload) ? change.payload : null;
      if (!payload) { R('PAYLOAD_REQUIRED', `${at}: payload object is required`); return; }
      const schema = spec.objectSchema(change.object_type);
      const declaredFields = new Set(Object.keys(schema?.properties || {}));
      Object.keys(payload).forEach((key) => {
        if (RESERVED_PAYLOAD_KEYS.includes(key) && !declaredFields.has(key)) R('RESERVED_RUNTIME_FIELD', `${at}: payload.${key} is runtime-owned (use state_patch)`);
      });
      (injected[change.object_type] || []).forEach((key) => {
        if (Object.prototype.hasOwnProperty.call(payload, key)) R('RUNTIME_INJECTED_FIELD', `${at}: payload.${key} is filled by the runtime; omit it`);
      });
      walkRefs(payload, (ref, path) => {
        if (isTempRef(ref)) {
          const target = tempIds.get(ref.temp_id);
          if (!target) R('TEMP_REF_UNRESOLVED', `${at}: payload.${path} temp_id ${ref.temp_id}`);
          else if (target.object_type !== ref.code) R('TEMP_REF_CODE_MISMATCH', `${at}: payload.${path} ${ref.temp_id} is ${target.object_type}, not ${ref.code}`);
        } else if (!inputKeys.has(Snapshot.refKey(ref)) || inputKeys.get(Snapshot.refKey(ref)).code !== ref.code) {
          R('REFERENCE_NOT_IN_SNAPSHOT', `${at}: payload.${path} ${Snapshot.refKey(ref)} is not in passport.input_refs`);
        }
      });
      // Object schema with runtime-owned values filled by placeholders.
      const probe = mapRefs(payload, (ref) => (isTempRef(ref) ? { code: ref.code, object_id: `${ref.code}-TMP`, version: 1 } : ref));
      (injected[change.object_type] || []).forEach((key) => { probe[key] = key === 'when' ? true : 'runtime'; });
      Schema.formatErrors(Schema.validate(schema, probe), 10).forEach((message) => R('OBJECT_SCHEMA', `${at}: payload${message.slice(1)}`));

      const statePatch = change.state_patch || {};
      const initial = contract.initial_statuses?.[change.object_type];
      const proposable = contract.model_status_proposals?.[change.object_type] || [];
      if (statePatch.status !== undefined && statePatch.status !== initial && !proposable.includes(statePatch.status)) {
        S('STATUS_NOT_PROPOSABLE', `${at}: state_patch.status ${statePatch.status} (allowed: ${[initial, ...proposable].filter(Boolean).join('|')})`);
      }
      (contract.required_state_patch?.[change.object_type] || []).forEach((key) => {
        if (statePatch[key] === undefined || statePatch[key] === null) R('STATE_PATCH_REQUIRED', `${at}: state_patch.${key} is required`);
      });
      plan.push({
        op: change.op,
        code: change.object_type,
        temp_id: change.temp_id,
        source_output_id: change.source_output_id,
        source_refs: change.source_refs || [],
        payload,
        proposed_status: statePatch.status,
        status: statePatch.status || initial,
        blocking: statePatch.blocking === true,
        authority_class: statePatch.authority_class ?? null
      });
    });

    // 6. cardinality per created code
    Object.entries(contract.cardinality || {}).forEach(([code, bounds]) => {
      const count = plan.filter((item) => item.code === code).length;
      if (bounds.min !== undefined && count < bounds.min) S('CARDINALITY_MIN', `stage ${stage.n} must create at least ${bounds.min} ${code} (got ${count})`);
      if (bounds.max !== undefined && count > bounds.max) S('CARDINALITY_MAX', `stage ${stage.n} must create at most ${bounds.max} ${code} (got ${count})`);
    });

    // 7. payload reference constraints (e.g. FND.target must be the reviewed PCON)
    Object.entries(contract.payload_ref_constraints || {}).forEach(([code, fields]) => {
      plan.filter((item) => item.code === code).forEach((item) => Object.entries(fields).forEach(([field, rule]) => {
        const ref = item.payload[field];
        if (!isObjectRef(ref) || !rule.codes.includes(ref.code) || !inputKeys.has(Snapshot.refKey(ref))) {
          S('PAYLOAD_REF_CONSTRAINT', `${code}.${field} must be a snapshot Ref of ${rule.codes.join('|')}`);
        }
      }));
    });

    // 8. dispositions (transformation coverage reconciliation)
    const consequences = [];
    if (!rc.dispositions_required) {
      if (value.dispositions.length) R('DISPOSITIONS_MUST_BE_EMPTY', `stage ${stage.n} is not a transformation stage`);
    } else {
      reconcileDispositions({ spec, rc, snapshot, value, plan, fateByInput, consequences, S, R });
    }

    // 9. Policy Engine: PD authority routing and QST coverage
    if (creates.has('PD')) applyDecisionPolicy({ contract, snapshotItems, plan, S, R, anomalies });

    return errors.length
      ? { ok: false, errors, anomalies }
      : { ok: true, errors: [], anomalies, plan: { creates: plan, consequences, outputs: value.outputs, model } };
  }

  function reconcileDispositions({ spec, rc, snapshot, value, plan, fateByInput, consequences, S, R }) {
    const accountable = new Map(snapshot.accountable.map((ref) => [Snapshot.refKey(ref), ref]));
    const allowed = new Set(rc.coverage_obligation?.allowed_outcomes || []);
    const byTemp = new Map(plan.filter((item) => item.temp_id).map((item) => [item.temp_id, item]));
    const seen = new Set();
    const lineage = (item, key) => item.source_refs.some((ref) => Snapshot.refKey(ref) === key);

    value.dispositions.forEach((disposition) => {
      const key = Snapshot.refKey(disposition.input_ref);
      const where = `disposition ${key} ${disposition.action}`;
      if (!accountable.has(key)) { R('DISPOSITION_FOREIGN_REF', `${where}: not an accountable input`); return; }
      if (seen.has(key)) { R('DISPOSITION_DUPLICATE', where); return; }
      seen.add(key);
      if (!allowed.has(disposition.action)) { S('DISPOSITION_ACTION_NOT_ALLOWED', where); return; }
      const results = disposition.result_temp_ids.map((temp) => byTemp.get(temp));
      if (results.some((item) => !item)) { R('DISPOSITION_RESULT_UNKNOWN', `${where}: result_temp_ids reference unknown temp_id`); return; }
      const successors = plan.filter((item) => lineage(item, key));
      const hidden = successors.filter((item) => !disposition.result_temp_ids.includes(item.temp_id));
      if (hidden.length) S('HIDDEN_TRANSFORMATION', `${where}: ${hidden.map((item) => item.temp_id).join(', ')} list this input in source_refs but are not declared`);
      if (results.some((item) => !lineage(item, key))) S('DISPOSITION_LINEAGE_MISSING', `${where}: each result must list the input in source_refs`);
      const fate = fateByInput.get(key)?.disposition;
      const code = disposition.input_ref.code;
      const to = (status, fallback = 'SUPERSEDED') => (spec.hasStatus(code, status) ? status : fallback);
      let consequence = null;
      switch (disposition.action) {
        case 'PRESERVE':
        case 'REJECT':
          if (results.length) S('DISPOSITION_RECONCILIATION', `${where}: result_temp_ids must be empty`);
          if (disposition.action === 'REJECT') {
            if (fate && fate !== 'REJECTED') S('INPUT_FATE_CONFLICT', `${where}: input_fate ${fate}`);
            consequence = to('REJECTED');
          } else if (fate && !['PRESERVED', 'CONSUMED', 'NOT_USED'].includes(fate)) S('INPUT_FATE_CONFLICT', `${where}: input_fate ${fate}`);
          break;
        case 'MERGE':
          if (results.length !== 1 || results[0].op !== 'MERGE') S('DISPOSITION_RECONCILIATION', `${where}: needs exactly one MERGE result`);
          consequence = to('MERGED');
          break;
        case 'SPLIT':
          if (results.length < 2) S('DISPOSITION_RECONCILIATION', `${where}: needs at least two results`);
          consequence = 'SUPERSEDED';
          break;
        case 'SUPERSEDE':
          if (results.length !== 1) S('DISPOSITION_RECONCILIATION', `${where}: needs exactly one replacement`);
          consequence = 'SUPERSEDED';
          break;
        case 'DEFER':
          if (results.length !== 1 || results[0].status !== 'DEFERRED') S('DISPOSITION_RECONCILIATION', `${where}: needs one successor with state_patch.status DEFERRED`);
          consequence = to('DEFERRED');
          break;
        default:
          S('DISPOSITION_ACTION_NOT_ALLOWED', where);
      }
      if (['MERGE', 'SPLIT', 'SUPERSEDE', 'DEFER'].includes(disposition.action) && fate && ['REJECTED', 'PRESERVED'].includes(fate)) {
        S('INPUT_FATE_CONFLICT', `${where}: input_fate ${fate}`);
      }
      if (consequence) consequences.push({ ref: disposition.input_ref, to_status: consequence, action: disposition.action });
    });
    const missing = [...accountable.keys()].filter((key) => !seen.has(key));
    if (missing.length) S('DISPOSITION_INCOMPLETE', `missing dispositions for ${missing.join(', ')}`);
  }

  function applyDecisionPolicy({ contract, snapshotItems, plan, S, anomalies }) {
    const dpl = [...snapshotItems.values()].find((item) => item.ref.code === 'DPL' && item.status === 'ACTIVE')
      || [...snapshotItems.values()].find((item) => item.ref.code === 'DPL');
    const allowedEffects = new Set(contract.qst_allowed_effects || []);
    const pds = plan.filter((item) => item.code === 'PD');
    const qsts = plan.filter((item) => item.code === 'QST');
    const pdByTemp = new Map(pds.map((item) => [item.temp_id, item]));
    const questioned = new Set();

    qsts.forEach((qst) => {
      const ref = qst.payload.decision_ref;
      const pd = isTempRef(ref) ? pdByTemp.get(ref.temp_id) : null;
      if (!pd) { S('QST_DECISION_REF', `QST ${qst.temp_id}: decision_ref must be a TempRef to a PD created in this response`); return; }
      questioned.add(pd.temp_id);
      (qst.payload.options || []).forEach((option) => (option.effects || []).forEach((effect) => {
        if (!allowedEffects.has(effect.effect_type)) S('QST_EFFECT_NOT_ALLOWED', `QST ${qst.temp_id} option ${option.option_id}: ${effect.effect_type}`);
        if ((effect.effect_type === 'CLOSE_PD' || effect.effect_type === 'DEFER_PD') && effect.target !== pd.temp_id) {
          S('QST_EFFECT_TARGET', `QST ${qst.temp_id} option ${option.option_id}: ${effect.effect_type} target must be ${pd.temp_id}`);
        }
        if (effect.effect_type === 'CLOSE_PD' && (typeof effect.value !== 'string' || !effect.value.trim())) {
          S('QST_EFFECT_VALUE', `QST ${qst.temp_id} option ${option.option_id}: CLOSE_PD needs the decision text as value`);
        }
      }));
      const ids = (qst.payload.options || []).map((option) => option.option_id);
      if (new Set(ids).size !== ids.length) S('QST_OPTION_DUPLICATE', `QST ${qst.temp_id}`);
    });

    pds.forEach((pd) => {
      const mode = policyMode(dpl?.payload, pd.authority_class, pd.payload.decision_kind);
      const proposed = pd.proposed_status;
      pd.policy_mode = mode;
      if (mode === 'AUTO_POLICY') {
        if (proposed === 'CLOSED' && !(typeof pd.payload.decision === 'string' && pd.payload.decision.trim())) {
          S('PD_CLOSED_WITHOUT_DECISION', `PD ${pd.temp_id}: a CLOSED decision needs payload.decision`);
        }
        pd.status = proposed || 'OPEN';
      } else if (mode === 'REQUIRE_EVIDENCE') {
        if (proposed === 'CLOSED') S('AUTHORITY_EXPANSION', `PD ${pd.temp_id} (${pd.authority_class}) needs evidence and cannot be closed by a model`);
        pd.status = proposed === 'DEFERRED' ? 'DEFERRED' : 'NEEDS_EVIDENCE';
      } else if (mode === 'REQUIRE_OWNER_SELECTION') {
        if (proposed === 'CLOSED') S('AUTHORITY_EXPANSION', `PD ${pd.temp_id} (${pd.authority_class}) requires the Owner and cannot be closed by a model`);
        pd.status = proposed === 'DEFERRED' ? 'DEFERRED' : 'OPEN';
        if (pd.status === 'OPEN' && !questioned.has(pd.temp_id)) S('QST_REQUIRED', `PD ${pd.temp_id} (${pd.authority_class}) needs a QST with decision_ref {"code":"PD","temp_id":"${pd.temp_id}"}`);
      } else {
        if (proposed === 'CLOSED') S('AUTHORITY_EXPANSION', `PD ${pd.temp_id} (${pd.authority_class}) is prohibited by policy`);
        pd.status = 'DEFERRED';
      }
      if (pd.status !== (proposed || 'OPEN')) anomalies.push(`Policy Engine: PD ${pd.temp_id} ${pd.authority_class}/${mode} -> ${pd.status}`);
    });
  }

  const api = Object.freeze({ validateResponse, policyMode, isTempRef, isObjectRef, mapRefs, walkRefs, BOOTSTRAP_MODES });
  root.AlValidator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
