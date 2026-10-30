const Engine = require(require('path').resolve(__dirname, '../../../disput/custom-engine.js'));
const Record = require(require('path').resolve(__dirname, '../../../disput/custom-run-record.js'));

const PASS = 'Review.\nВЕРДИКТ: ПРОШЁЛ';
const FAIL = 'Review.\nНЕ ВЫПОЛНЕНО: x\nВЕРДИКТ: НЕ ПРОШЁЛ';

function transport(answers) {
  const calls = [];
  const used = {};
  return {
    calls,
    send: async (models, prompts, meta) => {
      calls.push({ models: [...models], prompts: { ...prompts }, meta });
      const byModel = {};
      for (const model of models) {
        const index = used[model] || 0;
        used[model] = index + 1;
        const text = (answers[model] || [])[index] || '';
        byModel[model] = { text, status: text ? 'SUCCESS' : 'TIMEOUT' };
      }
      return { byModel, closedByOwner: false };
    }
  };
}

(async () => {
  const t = transport({ A: ['A-v1', 'A-based-on-B-v1'], B: ['B-v1', 'B-v2', 'B-v3'], G1: [FAIL, PASS, PASS], G2: [FAIL, PASS], C: ['consumer'] });
  const steps = [
    { ref: 'r1', kind: 'round', input: 'none', models: ['A'] },
    { ref: 'r2', kind: 'round', input: 'none', models: ['B'] },
    { ref: 'g1', kind: 'gate', criteria: ['c'], input: 'none', models: ['G1'], onFail: { goto: 'r1', maxLoops: 1, feedback: [{ step: 'r2', participant: 'B' }] } },
    { ref: 'g2', kind: 'gate', criteria: ['c'], input: 'none', models: ['G2'], onFail: { goto: 'r2', maxLoops: 1 } },
    { ref: 'r3', kind: 'round', input: [{ step: 'r1', participant: 'A', required: true }], models: ['C'] }
  ];
  const result = await Engine.run({ task: 'T', steps, send: t.send });
  const firstFeedback = t.calls.find((call) => call.models.includes('A') && call.prompts.A.includes('Замечания, вызвавшие возврат'))?.prompts.A;
  console.log('Feedback invalidation repro:', JSON.stringify({
    stopReason: result.stopReason,
    r1Visits: result.steps.filter((step) => step.ref === 'r1').map((step) => ({ visit: step.visit, valid: step.valid })),
    r2Visits: result.steps.filter((step) => step.ref === 'r2').map((step) => ({ visit: step.visit, valid: step.valid })),
    revisionPromptContainsBv1: firstFeedback?.includes('B-v1'),
    consumerSent: t.calls.some((call) => call.models.includes('C')),
    consumerPrompt: t.calls.find((call) => call.models.includes('C'))?.prompts.C
  }));

  const partial = {
    version: 2,
    runId: 'partial',
    taskRef: null,
    texts: {},
    attempts: [],
    artifacts: [],
    snapshot: { schema: [{ ref: 'r1', kind: 'round', models: ['A'] }], current: { active: false, stepRef: 'r1' } }
  };
  console.log('Partial snapshot resumability:', JSON.stringify({
    canResume: Record.canResume(partial),
    exportedResumable: Record.exportRun(partial).resumable,
    hasPc: Object.hasOwn(partial.snapshot, 'pc'),
    hasVisits: Object.hasOwn(partial.snapshot, 'visits'),
    hasDependencies: Object.hasOwn(partial.snapshot, 'dependencies'),
    hasLoopCounters: Object.hasOwn(partial.snapshot, 'loopCounters')
  }));
})();
