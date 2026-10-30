const Engine = require(require('path').resolve(__dirname, '../../../disput/custom-engine.js'));
const Record = require(require('path').resolve(__dirname, '../../../disput/custom-run-record.js'));
const snapshot = {
  schema: [{ ref: 'r1', kind: 'round', models: ['A'] }],
  current: { active: false, stepRef: 'r1' },
  // Deliberately missing pc, visits, results, decisions, loopCounters, continuationStack, feedback, dependencies.
};
const record = { version: 2, texts: {}, taskRef: null, attempts: [], artifacts: [], snapshot };
let sends = 0;
(async () => {
  const resumed = await Engine.run({ task: 'T', steps: [{ ref: 'r1', kind: 'round', input: 'none', models: ['A'] }],
    resume: snapshot, send: async () => { sends++; return { byModel: { A: { text: 'answer', status: 'SUCCESS' } } }; } });
  console.log(JSON.stringify({ canResume: Record.canResume(record), exportResumable: Record.exportRun(record).resumable,
    engineStopReason: resumed.stopReason, sends, completedSteps: resumed.steps.length, finalPc: resumed.state.pc }));
})();
