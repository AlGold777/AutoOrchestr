#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const hash=(p)=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex');
const manifest=read('manifest.json');
const stages=read('process/stages.json');
const al=read('objects/al-struct-1.schema.json');
const promptContract=read('execution/al-struct-1.prompt-contract.json');
const validators=read('execution/validators.json');
const tests=read('runtime/contract-tests.json');
const decomp=read('execution/decomposition-policy.json');
const coverage=read('execution/coverage-contracts.json');
const normalizer=read('execution/mutation-normalizer.json');
const storage=read('runtime/storage-contract.json');
const matrix=read('browser/provider-matrix.json');
const extraction=read('browser/structured-response-extraction.json');
const m1=read('tests/m1-transport-stage.json');
const boundary=read('integration/existing-runtime-boundary.json');
assert.equal(manifest.bundle_version,'2.2.3');
assert.equal(manifest.semantic_contract,'AL-STRUCT-1');
assert.equal(stages.length,30);
assert.equal(al.properties.passport.properties.input_snapshot_hash.pattern,'^[a-f0-9]{64}$');
assert.ok(al.required.includes('dispositions'));
assert.deepEqual(al.properties.dispositions.items.properties.action.enum,['PRESERVE','MERGE','SPLIT','SUPERSEDE','DEFER','REJECT']);
assert.ok(al.properties.changes.items.properties.state_patch);
assert.match(al.properties.annotations.description,/Diagnostic-only/i);
assert.equal(promptContract.full_schema_hash,hash('objects/al-struct-1.schema.json'));
assert.equal(promptContract.full_schema_ref,'objects/al-struct-1.schema.json');
assert.ok(validators.annotation_non_authoritative);
assert.ok(validators.mutation_normalization_valid);
assert.ok(validators.decomposition_coverage_valid);
assert.ok(validators.disposition_complete);
assert.ok(validators.transformation_balance_valid);
assert.deepEqual(coverage.domain_transformation_dispositions,['PRESERVE','MERGE','SPLIT','SUPERSEDE','DEFER','REJECT']);
assert.match(coverage.mode,/RECONCILIATION/);
assert.equal(normalizer.version,'2.2.3');
assert.equal(storage.authoritative_store,'IndexedDB');
for (const n of ['7','11','12','15']) { assert.ok(decomp.stages[n]); assert.ok(decomp.stages[n].max_items_per_partition > 0); }
for (const s of stages.filter(x=>[3,15].includes(x.n))) {
  assert.equal(s.response_contract.dispositions_required,true);
  assert.equal(s.response_contract.model_authored_dispositions,true);
  assert.equal(s.response_contract.coverage_reconciliation,'coverageContracts@2.2.3');
  assert.equal(s.response_contract.input_fate_is_not_domain_disposition,true);
}
const expected=['chatgpt','claude','gemini','grok','lechat','qwen','deepseek','perplexity','zai','kimi'];
assert.deepEqual(matrix.providers.map(x=>x.provider),expected);
for (const p of expected) {
  const profile=read(`browser/adapter-profiles/${p}.json`);
  assert.equal(profile.provider,p);
  assert.match(profile.structured_response_extraction,/textContent|raw text/i);
}
assert.deepEqual(extraction.interior_modes.map(x=>x.mode),['WHOLE_TEXT_JSON','SINGLE_FENCED_JSON']);
assert.ok(extraction.reject_if.some(x=>/more than one parseable JSON object/i.test(x)));
assert.equal(m1.commit_policy,'ZERO_CANONICAL_COMMIT');
assert.match(boundary.principle,/separate orchestration domains/i);
const ids=new Set(tests.map(t=>t.id));
for (const id of ['EXPLICIT_DISPOSITIONS_REQUIRED_STAGE3','EXPLICIT_DISPOSITIONS_REQUIRED_STAGE15','DISPOSITION_RECONCILIATION_REJECTS_CONFLICT','COMPACT_PROMPT_CONTRACT_HASH_MATCH','AL_STRUCT_SINGLE_FENCED_JSON_ACCEPTED','AL_STRUCT_MULTIPLE_JSON_CANDIDATES_REJECTED','M1_ZERO_COMMIT_PROBE','M1_FIRST_PASS_TELEMETRY_RECORDED','COST_TELEMETRY_MEASURED_NOT_ASSUMED','DISPUT_RUNTIME_NOT_CANONICAL_ENGINE']) assert.ok(ids.has(id),`missing ${id}`);
for (const p of expected) assert.ok(ids.has('PROVIDER_TEXTCONTENT_JSON_'+p.toUpperCase()),`missing provider test ${p}`);
assert.ok(tests.length>=80);
console.log(`PASS v2.2.3 COMPLETE: 30 stages, ${tests.length} contract tests, 10-provider matrix, explicit dispositions, compact prompt contract, zero-commit M1.`);
