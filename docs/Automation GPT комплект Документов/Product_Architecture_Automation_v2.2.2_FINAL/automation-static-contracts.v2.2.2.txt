#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const read=(p)=>JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));
const manifest=read('manifest.json');
const stages=read('process/stages.json');
const al=read('objects/al-struct-1.schema.json');
const validators=read('execution/validators.json');
const tests=read('runtime/contract-tests.json');
const decomp=read('execution/decomposition-policy.json');
const coverage=read('execution/coverage-contracts.json');
const normalizer=read('execution/mutation-normalizer.json');
const storage=read('runtime/storage-contract.json');
const matrix=read('browser/provider-matrix.json');
assert.equal(manifest.bundle_version,'2.2.2');
assert.equal(manifest.semantic_contract,'AL-STRUCT-1');
assert.equal(stages.length,30);
assert.equal(al.properties.passport.properties.input_snapshot_hash.pattern,'^[a-f0-9]{64}$');
assert.ok(al.properties.changes.items.properties.state_patch);
assert.match(al.properties.annotations.description,/Diagnostic-only/i);
assert.ok(validators.annotation_non_authoritative);
assert.ok(validators.mutation_normalization_valid);
assert.ok(validators.decomposition_coverage_valid);
assert.deepEqual(coverage.domain_transformation_dispositions,['PRESERVE','MERGE','SPLIT','SUPERSEDE','DEFER','REJECT']);
assert.equal(normalizer.version,'2.2.2');
assert.equal(storage.authoritative_store,'IndexedDB');
for (const n of ['7','11','12','15']) { assert.ok(decomp.stages[n]); assert.ok(decomp.stages[n].max_items_per_partition > 0); }
for (const s of stages.filter(x=>[3,15].includes(x.n))) {
  assert.equal(s.response_contract.coverage_derivation,'coverageContracts@2.2.2');
  assert.equal(s.response_contract.input_fate_is_not_domain_disposition,true);
}
const expected=['chatgpt','claude','gemini','grok','lechat','qwen','deepseek','perplexity','zai','kimi'];
assert.deepEqual(matrix.providers.map(x=>x.provider),expected);
for (const p of expected) {
  const profile=read(`browser/adapter-profiles/${p}.json`);
  assert.equal(profile.provider,p);
  assert.match(profile.structured_response_extraction,/textContent|raw text/i);
}
const ids=new Set(tests.map(t=>t.id));
for (const id of ['TRANSFORMATION_DISPOSITION_DERIVED_STAGE3','DEFER_DERIVED_FROM_STATE_PATCH','UPDATE_STATUS_SPLITS_REVISE_SET_STATUS','ANNOTATIONS_DIAGNOSTIC_ONLY','DECOMPOSITION_STAGE7_COVERS_SCENARIOS','INDEXEDDB_ATOMIC_STATE_COMMIT','EVIDENCE_REQUIRES_ARTIFACT','PROVIDER_MATRIX_MATCHES_MYORCHESTRATOR']) assert.ok(ids.has(id),`missing ${id}`);
for (const p of expected) assert.ok(ids.has('PROVIDER_TEXTCONTENT_JSON_'+p.toUpperCase()),`missing provider test ${p}`);
assert.ok(tests.length>=71);
console.log(`PASS v2.2.2: 30 stages, ${tests.length} contract tests, 10-provider matrix, four core blockers closed.`);
