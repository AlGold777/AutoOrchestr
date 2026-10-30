const fs = require('fs');
const path = require('path');
const Schema = require('../disput/basic-schema');
const DraftPlan = require('../disput/debate-draft-plan');
const Exchange = require('../docs/Pipeline scenarios/canvas-prototype/basic-export');
const examples = JSON.parse(fs.readFileSync(path.join(__dirname, '../docs/Pipeline scenarios/canvas-prototype/stand-examples.json'), 'utf8'));
const list = Object.values(examples).map((e) => e.schema || e);

// Mirrors results.js: recordFromSchema (validate → same-model check → toCanvas → createCanvasPlan → record).
// Page-only inputs are replaced: models = names in the schema, isRole = any role, runWords = the select options.
const RUN_WORDS = [300, 500, 700, 1000];
function recordChain(schema) {
  const errors = Schema.validate(schema);
  if (errors.length) return { stage: 'validate', errors };
  const twice = [];
  (schema.steps || []).forEach((step, at) => {
    const names = (step.models || []).filter((m) => m.enabled !== false).map((m) => m.name);
    names.forEach((n, i) => { if (names.indexOf(n) !== i) twice.push({ path: `steps[${at}].models`, message: `два участника модели «${n}»` }); });
  });
  if (twice.length) return { stage: 'same-model', errors: twice };
  const models = [...new Set((schema.steps || []).flatMap((s) => (s.models || []).map((m) => m.name)))];
  const canvas = Schema.toCanvas(schema, { models, isRole: () => true, runWords: RUN_WORDS });
  if (canvas.errors.length) return { stage: 'toCanvas', errors: canvas.errors };
  const run = Schema.resolveRun(schema);
  const plan = DraftPlan.createCanvasPlan({
    planId: 'canvas-test', revision: 0,
    rounds: canvas.rounds.map((round, index) => ({
      plannedStageId: `canvas-${round.ref}`, label: index === 0 ? 'R1 Models' : `R${index + 1}`, purpose: index === 0 ? 'position' : 'response',
      participantIds: round.participantIds,
      participantBindings: round.participantIds.map((participantId) => ({ participantId, promptId: round.roles[participantId] }))
    }))
  });
  return { stage: 'ok', errors: [], record: { roundCounter: canvas.roundCounter, run, planRounds: plan.rounds ? plan.rounds.length : null, stacks: canvas.stacks } };
}

describe('stand export → real Basic import chain (node)', () => {
  const cases = list.map((schema, i) => [i, schema]).map(([i, s]) => [i, Exchange.toBasic(s)]).filter(([, r]) => r.schema.steps.length > 0);
  test('there is at least one example with steps', () => { expect(cases.length).toBeGreaterThan(0); });
  test.each(cases.map(([i, r]) => [i, r.schema, r.warnings]))('example %s: toBasic output passes the import chain', (i, basic, warnings) => {
    const result = recordChain(basic);
    if (result.errors.length) throw new Error(`stage ${result.stage}: ${JSON.stringify(result.errors)}\nwarnings: ${JSON.stringify(warnings)}`);
    expect(result.errors).toEqual([]);
    expect(result.record.roundCounter).toBeGreaterThanOrEqual(0);
  });
});
