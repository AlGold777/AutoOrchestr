// Automation Lab — spec bundle loader + manifest_lint for the pilot stage range.
// The runtime never hard-codes the stage graph: stage contracts, object schemas, status enums and
// the AL-STRUCT-1 contract all come from automation-spec/ (synced from the canonical docs bundle).
(function initAlSpec(root) {
  'use strict';

  const Canonical = root.AlCanonical || require('./al-canonical.js');

  const RUNTIME_FILES = Object.freeze({
    manifest: 'manifest.json',
    stages: 'process/stages.json',
    statusEnums: 'process/status-enums.json',
    objectSchemas: 'objects/object-schemas.json',
    alSchema: 'objects/al-struct-1.schema.json',
    promptContract: 'execution/al-struct-1.prompt-contract.json',
    coverage: 'execution/coverage-contracts.json',
    extraction: 'browser/structured-response-extraction.json',
    contextPolicy: 'policy/context-policy.json',
    repairPolicy: 'execution/repair-policy.json',
    questionnaire: 'interaction/questionnaire-contract.json',
    registryEntry: 'objects/registry-entry.schema.json',
    eventSchema: 'objects/event.schema.json'
  });

  const PILOT_STAGES = Object.freeze([1, 2, 3, 4, 5]);
  const REF_PATTERN = /^[A-Z][A-Z0-9_]*-[0-9A-Za-z._-]+$/;

  async function loadFromFetch(baseUrl = 'automation-spec/') {
    const entries = await Promise.all(Object.entries(RUNTIME_FILES).map(async ([key, rel]) => {
      const response = await fetch(`${baseUrl}${rel}`);
      if (!response.ok) throw new Error(`SPEC_FILE_MISSING ${rel} (${response.status})`);
      return [key, await response.json()];
    }));
    return create(Object.fromEntries(entries));
  }

  function loadFromDir(dir) {
    const fs = require('fs');
    const path = require('path');
    const files = {};
    Object.entries(RUNTIME_FILES).forEach(([key, rel]) => {
      files[key] = JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
    });
    return create(files);
  }

  function lint(files, stageNumbers = PILOT_STAGES) {
    const problems = [];
    const fail = (code, detail) => problems.push({ code, detail });
    const { stages, statusEnums, objectSchemas, alSchema, promptContract, manifest } = files;

    if (!Array.isArray(stages) || stages.length !== 30) fail('STAGE_COUNT', `expected 30 stages, got ${stages?.length}`);
    const expectedHash = Canonical.hashJson(alSchema);
    if (promptContract.full_schema_hash !== expectedHash) {
      fail('COMPACT_CONTRACT_STALE', `prompt contract full_schema_hash ${promptContract.full_schema_hash} != ${expectedHash}`);
    }
    if (!Canonical.isBareHash(promptContract.full_schema_hash)) fail('HASH_FORMAT', 'full_schema_hash is not bare 64-hex');
    if (manifest.semantic_contract !== 'AL-STRUCT-1') fail('SEMANTIC_CONTRACT', manifest.semantic_contract);

    const known = new Set(Object.keys(objectSchemas));
    const changeTypes = new Set(alSchema.properties.changes.items.properties.object_type.enum);
    stageNumbers.forEach((n) => {
      const stage = stages.find((item) => item.n === n);
      if (!stage) { fail('STAGE_MISSING', n); return; }
      const where = `stage ${n}`;
      const contract = stage.contract || {};
      const rc = stage.response_contract || {};
      (contract.input_selectors || []).forEach((selector) => (selector.codes || []).forEach((code) => {
        if (!known.has(code)) fail('UNKNOWN_CODE', `${where} selector ${code}`);
        (selector.statuses || []).forEach((status) => {
          if (!(statusEnums[code] || []).includes(status)) fail('UNKNOWN_STATUS', `${where} selector ${code}:${status}`);
        });
      }));
      [...(contract.creates || []), ...(contract.modifies || [])].forEach((code) => {
        if (!known.has(code)) fail('UNKNOWN_CODE', `${where} creates/modifies ${code}`);
        if (!changeTypes.has(code)) fail('CODE_NOT_IN_AL_STRUCT', `${where} ${code}`);
      });
      (contract.creates || []).forEach((code) => {
        const initial = contract.initial_statuses?.[code];
        if (!initial) fail('INITIAL_STATUS_MISSING', `${where} ${code}`);
        else if (!(statusEnums[code] || []).includes(initial)) fail('INITIAL_STATUS_INVALID', `${where} ${code}:${initial}`);
      });
      Object.entries(contract.model_status_proposals || {}).forEach(([code, statuses]) => statuses.forEach((status) => {
        if (!(statusEnums[code] || []).includes(status)) fail('PROPOSABLE_STATUS_INVALID', `${where} ${code}:${status}`);
      }));
      if (rc.dispositions_required && !rc.coverage_obligation) fail('COVERAGE_OBLIGATION_MISSING', where);
      if (rc.requires_material_output && rc.allows_empty_by_design) fail('EMPTY_POLICY_CONTRADICTION', where);
      const fanout = stage.execution?.fanout;
      if (stage.independent && !fanout) fail('FANOUT_MISSING', where);
      if (fanout && fanout.min_distinct_models > fanout.max_runs) fail('FANOUT_BOUNDS', where);
      const repairBudget = files.repairPolicy?.representation_level?.max_repairs_per_call;
      if (stage.execution?.repair_attempts !== undefined && stage.execution.repair_attempts !== repairBudget) {
        fail('REPAIR_BUDGET_CONTRADICTION', `${where}: ${stage.execution.repair_attempts} != ${repairBudget}`);
      }
      const routes = [].concat(stage.next?.on_success || []);
      routes.forEach((route) => {
        const target = route.stage || route.resume_stage;
        if (target && !stages.some((item) => item.n === target)) fail('ROUTE_TARGET_MISSING', `${where} -> ${target}`);
      });
    });

    // Every pilot stage input must be producible by an earlier pilot stage, the IDEA or the runtime.
    const produced = new Set(['IDEA']);
    stageNumbers.forEach((n) => {
      const stage = stages.find((item) => item.n === n);
      if (!stage) return;
      (stage.contract.input_selectors || []).filter((selector) => selector.required).forEach((selector) => {
        selector.codes.forEach((code) => {
          if (!produced.has(code)) fail('INPUT_NOT_PRODUCIBLE', `stage ${n} requires ${code}`);
          const statuses = selector.statuses || [];
          const reachable = statuses.length === 0 || stageNumbers.some((m) => m < n && (() => {
            const prior = stages.find((item) => item.n === m);
            return statuses.includes(prior?.contract?.initial_statuses?.[code])
              || (code === 'DPL' && prior?.contract?.runtime_questionnaire === 'DPL_APPROVAL' && statuses.includes('ACTIVE'));
          })()) || (code === 'IDEA' && statuses.includes('ACTIVE'));
          if (!reachable) fail('INPUT_STATUS_UNREACHABLE', `stage ${n} requires ${code} in ${statuses.join('|')}`);
        });
      });
      (stage.contract.creates || []).forEach((code) => produced.add(code));
    });
    return problems;
  }

  function create(files) {
    const problems = lint(files);
    const stageMap = new Map(files.stages.map((stage) => [stage.n, stage]));
    const api = {
      files,
      problems,
      ok: problems.length === 0,
      version: files.manifest.bundle_version,
      pilotStages: PILOT_STAGES,
      stage: (n) => stageMap.get(Number(n)) || null,
      objectSchema: (code) => files.objectSchemas[code] || null,
      statuses: (code) => files.statusEnums[code] || [],
      hasStatus: (code, status) => (files.statusEnums[code] || []).includes(status),
      contextLimits: () => ({
        maxPromptChars: Number(files.contextPolicy.maxPromptChars) || 60000,
        maxOutputContentChars: Number(files.contextPolicy.maxOutputContentChars) || 8000,
        truncMarker: files.contextPolicy.safe_truncation?.marker || '[OBJ:TRUNC]'
      }),
      repairBudget: () => Number(files.repairPolicy?.representation_level?.max_repairs_per_call ?? 1),
      isRefShape: (value) => Boolean(value && typeof value === 'object' && typeof value.code === 'string'
        && typeof value.object_id === 'string' && REF_PATTERN.test(value.object_id) && Number.isInteger(value.version))
    };
    return Object.freeze(api);
  }

  const api = Object.freeze({ RUNTIME_FILES, PILOT_STAGES, loadFromFetch, loadFromDir, create, lint });
  root.AlSpec = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
