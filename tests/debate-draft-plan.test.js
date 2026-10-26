const DraftPlan = require('../disput/debate-draft-plan');

describe('DraftPlan — persistent Canvas execution graph', () => {
  test('materializes Canvas rounds as one ordered graph; a synthesizer is not a stage of its own', () => {
    const plan = DraftPlan.createCanvasPlan({
      planId: 'p1', synthesizer: 'Claude',
      rounds: [
        { plannedStageId: 'canvas-r1', purpose: 'position', participantIds: ['GPT', 'Gemini'] },
        { plannedStageId: 'canvas-r2', purpose: 'response', participantIds: ['Claude'] }
      ]
    });
    expect(plan.plannedStages.map((stage) => stage.plannedStageId)).toEqual(['canvas-r1', 'canvas-r2']);
    expect(plan.plannedStages[1].upstream).toEqual(['canvas-r1']);
    expect(DraftPlan).not.toHaveProperty('insertSynthesis');
  });

  test('a stored plan with a synthesis stage of an older version is still read', () => {
    const plan = DraftPlan.normalize({ plannedStages: [
      { plannedStageId: 'canvas-r1', purpose: 'position', participantIds: ['GPT'] },
      { plannedStageId: 'planned-final-synthesis', purpose: 'synthesis', participantIds: ['Claude'], upstream: ['canvas-r1'], outputIntent: 'candidate_final' }
    ] });
    expect(plan.plannedStages.map((stage) => stage.plannedStageId)).toEqual(['canvas-r1', 'planned-final-synthesis']);
  });

  test('detects a dependency cycle before a DraftPlan can start a run', () => {
    const plan = DraftPlan.normalize({
      plannedStages: [
        { plannedStageId: 'a', purpose: 'position', participantIds: ['GPT'], upstream: ['b'] },
        { plannedStageId: 'b', purpose: 'response', participantIds: ['Claude'], upstream: ['a'] }
      ]
    });
    expect(DraftPlan.validate(plan)).toMatchObject({ valid: false, errors: expect.arrayContaining([
      expect.objectContaining({ code: 'DEPENDENCY_CYCLE' })
    ]) });
  });
});
