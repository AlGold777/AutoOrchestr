// Repro for stale artifact fallback in AutoOrchestr at 233adeed8.
// r1 creates v1; r2 revises to v2; gate returns to r2, whose retry is skipped;
// r4 requires latest. The current engine incorrectly feeds the old v1.
const Engine = require(require('path').resolve(__dirname, '../../../disput/custom-engine.js'));

const originalOutput = {
  format: 'json', requiredFields: ['/map'],
  artifacts: [{ id: 'map', name: 'Map', pointer: '/map' }]
};
const original = {
  artifact: { step: 'r1', participant: 'A', id: 'map' }, version: 'latest', required: true
};
const revisionOutput = {
  format: 'json', requiredFields: ['/map'],
  artifacts: [{ id: 'map', name: 'Revised map', pointer: '/map', revisionOf: original }]
};
const steps = [
  { ref: 'r1', kind: 'round', input: 'none', models: ['A'], output: originalOutput },
  { ref: 'r2', kind: 'round', input: [original], models: ['B'], output: revisionOutput },
  { ref: 'gate:g', kind: 'gate', input: 'previous', criteria: ['check'], models: ['C'],
    onFail: { goto: 'r2', maxLoops: 1 } },
  { ref: 'r4', kind: 'round', input: [{
    artifact: { step: 'r1', participant: 'A', id: 'map' }, version: 'latest', required: true
  }], models: ['D'] }
];
const replies = {
  A: ['{"map":"v1"}'],
  B: ['{"map":"v2"}', ''],
  C: ['НЕ ВЫПОЛНЕНО: check\nВЕРДИКТ: НЕ ПРОШЁЛ', 'ВЕРДИКТ: ПРОШЁЛ'],
  D: ['consumed']
};
const counts = {};
const calls = [];
const send = async (models, prompts, meta) => {
  calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
  const byModel = {};
  for (const model of models) {
    const at = counts[model] || 0;
    counts[model] = at + 1;
    const text = replies[model]?.[at] || '';
    byModel[model] = { text, status: text ? 'SUCCESS' : 'TIMEOUT' };
  }
  return { byModel, closedByOwner: false };
};

Engine.run({ task: 'T', steps, send, maxAttempts: 1, decide: async () => 'skip' }).then((result) => {
  const d = calls.find((call) => call.models.includes('D'));
  console.log(JSON.stringify({
    stopReason: result.stopReason,
    dPromptContainsOldV1: d?.prompts.D.includes('\nv1'),
    artifacts: result.artifacts.map((item) => ({ source: item.source, valid: item.valid, answerRef: item.content.answerRef }))
  }, null, 2));
}).catch((error) => { console.error(error); process.exitCode = 1; });
