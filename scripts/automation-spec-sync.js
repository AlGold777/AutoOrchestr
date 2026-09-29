#!/usr/bin/env node
// Keeps the Automation Layer bundle internally consistent.
//   1. The split files under docs/<bundle>/ are canonical. The monolith JSON is regenerated from them
//      (v2.2.3 kept both by hand and they could drift silently).
//   2. FILE_MANIFEST_SHA256.txt is regenerated.
//   3. The runtime subset used by automation_lab.html is copied to automation-spec/.
// `--check` performs no writes and exits 1 when anything is out of sync (used by jest).
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
const BUNDLE = path.join(REPO, 'docs', 'Automation GPT комплект Документов');
const MONOLITH = 'product_architecture_framework_automation_layer_v2.2.3.json';
const RUNTIME_DIR = path.join(REPO, 'automation-spec');

// monolith JSON path -> canonical split file
const MONOLITH_SECTIONS = [
  [['authorityLadder'], 'policy/authority-ladder.json'],
  [['policies', 'evidencePolicy'], 'policy/evidence-policy.json'],
  [['policies', 'riskPolicy'], 'policy/risk-policy.json'],
  [['statusEnums'], 'process/status-enums.json'],
  [['schemas', 'RegistryEntry'], 'objects/registry-entry.schema.json'],
  [['schemas', 'ProjectState'], 'runtime/project-state.schema.json'],
  [['schemas', 'ModelSemanticResponse'], 'objects/semantic-response.schema.json'],
  [['schemas', 'ResponseEnvelope'], 'objects/response-envelope.schema.json'],
  [['schemas', 'AL_STRUCT_1'], 'objects/al-struct-1.schema.json'],
  [['schemas', 'ContextAssemblyAudit'], 'runtime/context-audit.schema.json'],
  [['objects'], 'objects/object-schemas.json'],
  [['baselines'], 'process/baselines.json'],
  [['validators'], 'execution/validators.json'],
  [['gates'], 'process/gates.json'],
  [['stages'], 'process/stages.json'],
  [['graph'], 'process/dependency-graph.json'],
  [['controlFlow'], 'process/control-flow.json'],
  [['promptBuilder'], 'execution/prompt-builder.json'],
  [['runtime', 'storage'], 'runtime/storage-contract.json'],
  [['runtime', 'dom_json_extraction'], 'browser/structured-response-extraction.json'],
  [['runtime', 'provider_matrix'], 'browser/provider-matrix.json'],
  [['runtime', 'structured_response_extraction'], 'browser/structured-response-extraction.json'],
  [['runtime', 'm1_telemetry'], 'runtime/m1-telemetry-contract.json'],
  [['runtime', 'cost_telemetry'], 'runtime/cost-telemetry-contract.json'],
  [['runtime', 'm1_transport_probe'], 'tests/m1-transport-stage.json'],
  [['runtime', 'integration_boundary'], 'integration/existing-runtime-boundary.json'],
  [['runtime', 'compact_prompt_contract'], 'execution/al-struct-1.prompt-contract.json'],
  [['toolPolicy'], 'policy/tool-policy.json'],
  [['modelPolicy'], 'policy/model-policy.json'],
  [['contractTests'], 'runtime/contract-tests.json'],
  [['migrations'], 'runtime/schema-migrations.json'],
  [['contextPolicy'], 'policy/context-policy.json'],
  [['mutationNormalizer'], 'execution/mutation-normalizer.json'],
  [['coverageContracts'], 'execution/coverage-contracts.json'],
  [['decompositionPolicy'], 'execution/decomposition-policy.json'],
  [['storageContract'], 'runtime/storage-contract.json'],
  [['evidenceCollector'], 'execution/evidence-collector-contract.json']
];

// Files the extension page loads at runtime (automation/al-spec.js RUNTIME_FILES must match).
const RUNTIME_FILES = [
  'manifest.json',
  'process/stages.json',
  'process/status-enums.json',
  'objects/object-schemas.json',
  'objects/al-struct-1.schema.json',
  'execution/al-struct-1.prompt-contract.json',
  'execution/coverage-contracts.json',
  'browser/structured-response-extraction.json',
  'policy/context-policy.json',
  'execution/repair-policy.json',
  'interaction/questionnaire-contract.json',
  'objects/registry-entry.schema.json',
  'objects/event.schema.json'
];

const readText = (file) => fs.readFileSync(file, 'utf8');
const readJson = (file) => JSON.parse(readText(file));
const pretty = (value) => `${JSON.stringify(value, null, 2)}\n`;

function buildMonolith() {
  const monolith = readJson(path.join(BUNDLE, MONOLITH));
  const manifest = readJson(path.join(BUNDLE, 'manifest.json'));
  for (const [keys, rel] of MONOLITH_SECTIONS) {
    let target = monolith;
    keys.slice(0, -1).forEach((key) => { target[key] = target[key] || {}; target = target[key]; });
    target[keys[keys.length - 1]] = readJson(path.join(BUNDLE, rel));
  }
  monolith.automation_layer_version = manifest.automation_layer_version;
  monolith.bundle_version = manifest.bundle_version;
  if (typeof monolith.contract_patch_version === 'string') monolith.contract_patch_version = manifest.bundle_version;
  return pretty(monolith);
}

function listBundleFiles(dir = BUNDLE, prefix = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return listBundleFiles(path.join(dir, entry.name), rel);
    return rel === 'FILE_MANIFEST_SHA256.txt' ? [] : [rel];
  }).sort();
}

function buildShaManifest(overrides) {
  return `${listBundleFiles().map((rel) => {
    const content = overrides.has(rel) ? Buffer.from(overrides.get(rel)) : fs.readFileSync(path.join(BUNDLE, rel));
    return `${crypto.createHash('sha256').update(content).digest('hex')}  ${rel}`;
  }).join('\n')}\n`;
}

function run({ check }) {
  const planned = new Map();
  const monolithText = buildMonolith();
  planned.set(path.join(BUNDLE, MONOLITH), monolithText);
  planned.set(path.join(BUNDLE, 'FILE_MANIFEST_SHA256.txt'), buildShaManifest(new Map([[MONOLITH, monolithText]])));
  RUNTIME_FILES.forEach((rel) => planned.set(path.join(RUNTIME_DIR, rel), readText(path.join(BUNDLE, rel))));

  const drift = [];
  planned.forEach((content, file) => {
    const current = fs.existsSync(file) ? readText(file) : null;
    if (current === content) return;
    drift.push(path.relative(REPO, file));
    if (!check) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
    }
  });
  return drift;
}

if (require.main === module) {
  const check = process.argv.includes('--check');
  const drift = run({ check });
  if (check && drift.length) {
    console.error(`Automation spec out of sync (run: node scripts/automation-spec-sync.js):\n  ${drift.join('\n  ')}`);
    process.exit(1);
  }
  console.log(check ? 'Automation spec in sync.' : `Automation spec synced (${drift.length} file(s) updated).`);
}

module.exports = { run, RUNTIME_FILES, BUNDLE, RUNTIME_DIR };
