// "Разработка архитектуры" template: the 30-stage framework catalogue, the stage
// brief travelling plan → planner → prompt, and the stage card behind the round badge.
const fs = require('fs');
const path = require('path');
const Framework = require('../disput/architecture-framework');
const StageCard = require('../results/stage-card');
const DraftPlan = require('../disput/debate-draft-plan');
const Compiler = require('../disput/debate-prompt-compiler');
const Generator = require('../scripts/build-architecture-framework');

const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('architecture framework catalogue', () => {
  test('is generated from the framework and up to date', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'disput', 'architecture-framework.js'), 'utf8')).toBe(Generator.build());
  });

  test('has 30 numbered stages, four moderator gates, and a brief for each', () => {
    expect(Framework.STAGES.map((stage) => stage.n)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    expect(Framework.STAGES.filter((stage) => stage.who === 'gate').map((stage) => [stage.n, stage.gate]))
      .toEqual([[13, 'G1'], [17, 'G2'], [22, 'G3'], [30, 'G4']]);
    Framework.STAGES.forEach((stage) => {
      expect(stage.titleRu).toBeTruthy();
      expect(stage.instruction).toContain(`Этап ${stage.n}.`);
    });
    // The stage text is the framework's own: stage 18 is independent and forbids peeking.
    expect(Framework.byNumber(18)).toMatchObject({ independent: true, purpose: 'position', who: 'all' });
    expect(Framework.byNumber(18).instruction).toContain('Смотреть чужие candidates');
  });

  test('who works at a stage: all, the lead, a reviewer other than the lead, nobody at a gate', () => {
    const models = ['Claude', 'GPT', 'Gemini'];
    expect(Framework.participantsFor(Framework.byNumber(18), models)).toEqual(models);
    expect(Framework.participantsFor(Framework.byNumber(1), models)).toEqual(['Claude']);
    expect(Framework.participantsFor(Framework.byNumber(8), models)).toEqual(['GPT']);
    expect(Framework.participantsFor(Framework.byNumber(8), ['Claude'])).toEqual(['Claude']);
    expect(Framework.participantsFor(Framework.byNumber(13), models)).toEqual([]);
    expect(Framework.participantsFor(Framework.byNumber(1), [])).toEqual([]);
  });

  test('every purpose is one the engine knows and none needs a JSON-only audit', () => {
    const known = ['position', 'response', 'critique', 'verification', 'evidence_review', 'synthesis', 'human_judgment'];
    Framework.STAGES.forEach((stage) => expect(known).toContain(stage.purpose));
  });
});

describe('stage brief reaches the model', () => {
  const rounds = Framework.STAGES.filter((stage) => stage.who !== 'gate').slice(0, 3).map((stage) => ({
    plannedStageId: `canvas-r${stage.n}`, label: `${stage.n}. ${stage.titleRu}`, purpose: stage.purpose,
    instruction: stage.instruction, meta: { stageTemplate: 'architecture', stageNumber: stage.n },
    participantIds: ['Claude']
  }));

  test('the draft plan keeps instruction and meta; gates (no participants) are not planned', () => {
    const plan = DraftPlan.createCanvasPlan({ rounds: [...rounds, { plannedStageId: 'canvas-r13', participantIds: [] }] });
    expect(plan.plannedStages).toHaveLength(3);
    expect(plan.plannedStages[0]).toMatchObject({ plannedStageId: 'canvas-r1', instruction: rounds[0].instruction, meta: { stageNumber: 1 } });
    expect(plan.plannedStages[1].upstream).toEqual(['canvas-r1']);
    expect(DraftPlan.validate(plan).valid).toBe(true);
    // Round trip through normalize (storage) keeps it.
    expect(DraftPlan.normalize(plan).plannedStages[2].instruction).toBe(rounds[2].instruction);
  });

  test('a stage without a brief is unchanged', () => {
    const plan = DraftPlan.createCanvasPlan({ rounds: [{ plannedStageId: 'canvas-r1', participantIds: ['GPT'] }] });
    expect(plan.plannedStages[0]).not.toHaveProperty('instruction');
    expect(plan.plannedStages[0]).not.toHaveProperty('meta');
  });

  test.each([['position', 'opening'], ['critique', 'critique'], ['synthesis', 'synthesis']])('the prompt of a %s stage carries the brief', (purpose, operation) => {
    const stage = Framework.STAGES.find((item) => item.purpose === purpose);
    const compiled = Compiler.compile({
      task: { objective: 'Система учёта заказов', maxWords: 300 },
      action: { id: 'a', operation, role: purpose === 'synthesis' ? 'synthesizer' : 'participant', instruction: stage.instruction },
      stage: { stageId: 's', operation, role: purpose === 'synthesis' ? 'synthesizer' : 'participant', expectedArtifactTypes: [] },
      model: 'GPT'
    });
    expect(compiled.prompt).toContain(`Этап ${stage.n}.`);
    expect(compiled.prompt).toContain('Система учёта заказов');
  });

  test('planner and orchestrator hand the brief on; the panel feeds it to the compiler', () => {
    expect(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-planner.js'), 'utf8'))
      .toContain('...(stage.instruction ? { instruction: stage.instruction } : {})');
    expect(fs.readFileSync(path.join(__dirname, '..', 'disput', 'debate-orchestrator.js'), 'utf8'))
      .toContain('...(proposed.instruction ? { instruction: proposed.instruction } : {})');
    expect(source).toContain('action: stage.instruction ? {');
  });
});

describe('stage card', () => {
  const stack = [{ name: 'Claude', send: true }, { name: 'GPT', send: false }];

  test('a template stage shows its framework text, who works and the run status', () => {
    const model = StageCard.buildModel({ round: 18, templateStage: Framework.byNumber(18), participants: [{ name: 'Claude', send: true }, { name: 'GPT', send: true }], stageRun: { status: 'completed' } });
    expect(model.title).toBe('Этап 18 · Независимые архитектурные предложения');
    expect(model.badges).toEqual(expect.arrayContaining(['независимый', 'позиция', 'все модели независимо']));
    expect(model.sections.map((section) => section.title)).toEqual(expect.arrayContaining(['Входы', 'Что нужно сделать', 'Чего делать нельзя', 'Правила']));
    expect(model.participants.working).toEqual(['Claude', 'GPT']);
    expect(model.status).toEqual({ code: 'completed', label: 'Выполнен' });
    expect(model.instruction).toContain('Этап 18.');
  });

  test('a gate is a moderator checkpoint with no working models', () => {
    const model = StageCard.buildModel({ round: 13, templateStage: Framework.byNumber(13), participants: stack.map((item) => ({ ...item, send: false })) });
    expect(model.status.code).toBe('gate');
    expect(model.badges).toEqual(expect.arrayContaining(['ворота G1']));
    expect(model.participants.working).toEqual([]);
  });

  test('a plain round lists its participants', () => {
    const model = StageCard.buildModel({ round: 2, participants: stack });
    expect(model.title).toBe('Этап 2');
    expect(model.sections).toEqual([{ title: 'Участники раунда', items: ['Claude'] }]);
    expect(model.status.code).toBe('pending');
  });

  test('render writes text only (no markup injection) and offers a copy action', () => {
    const container = document.createElement('div');
    const onCopy = jest.fn();
    const model = StageCard.buildModel({ round: 1, templateStage: { ...Framework.byNumber(1), instruction: '<img src=x onerror=alert(1)> brief', inputs: ['<b>x</b>'] }, participants: stack });
    StageCard.render(container, model, { onCopy });
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('.stage-card-instruction').textContent).toContain('<img');
    container.querySelector('.stage-card-copy').click();
    expect(onCopy).toHaveBeenCalledWith(model.instruction);
    expect(container.textContent).toContain('Не участвуют: GPT');
  });
});

describe('template wiring', () => {
  test('the built-in pipeline is semi-automatic with 30 stages and a stage template', () => {
    const Presets = require('../disput/pipeline-presets');
    const definition = Presets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.name === 'Architecture');
    expect(definition).toMatchObject({ runPolicy: 'manual', roundLimit: '30', stageTemplate: 'architecture', presetId: 'ARCHITECTURE' });
    expect(Presets.normalizePipelinePreset('ARCHITECTURE', { currentUiLimits: { maxTotalStages: 30 } })).toMatchObject({ maxTotalStages: 30 });
  });

  test('the panel assigns who works per stage, keeps the stage count, and opens the card on the badge', () => {
    expect(source).toContain('const applyStageTemplateAssignments = () => {');
    expect(source).toContain('if (applyStageTemplateAssignments()) changed = true;');
    expect(source).toContain("activeStageTemplate = String(protocol?.stageTemplate || '');");
    expect(source).toContain('Число этапов задаёт шаблон');
    expect(source).toContain('openStageCard(stageBadge);');
    const html = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(html.indexOf('disput/architecture-framework.js')).toBeGreaterThan(-1);
    expect(html.indexOf('disput/architecture-framework.js')).toBeLessThan(html.indexOf('<script src="results.js">'));
    expect(html.indexOf('results/stage-card.js')).toBeLessThan(html.indexOf('<script src="results.js">'));
    expect(html).toContain('id="pipeline-stage-card"');
  });
});

describe('template run through the real engine', () => {
  const Application = require('../disput/debate-application');

  test('a template stage executes with its own brief, gates are skipped, models follow the assignment', async () => {
    const models = ['Claude', 'GPT', 'Gemini'];
    const stages = [1, 2, 3, 13, 4].map((n) => Framework.byNumber(n));
    const rounds = stages.map((stage) => ({
      plannedStageId: `canvas-r${stage.n}`, label: `${stage.n}. ${stage.titleRu}`, purpose: stage.purpose,
      instruction: stage.instruction, meta: { stageTemplate: 'architecture', stageNumber: stage.n },
      participantIds: Framework.participantsFor(stage, models)
    }));
    const draftPlan = DraftPlan.createCanvasPlan({ rounds, synthesizer: '' });
    expect(draftPlan.plannedStages.map((stage) => stage.plannedStageId)).toEqual(['canvas-r1', 'canvas-r2', 'canvas-r3', 'canvas-r4']);

    const prompts = [];
    const app = Application.createApplication({
      universalEngine: true, allowIncompleteWiring: true, exposeInternals: true,
      deps: {
        runModelBatch: async ({ models: batchModels, promptsByModel, prompt }) => {
          batchModels.forEach((model) => prompts.push({ model, prompt: promptsByModel?.[model] || prompt }));
          return { responses: Object.fromEntries(batchModels.map((model) => [model, `answer from ${model}`])), results: {} };
        },
        compilePrompt: ({ stage, participant }) => `STAGE ${stage.stageInstanceId} FOR ${participant.participantId}: ${stage.instruction || 'NO BRIEF'}`,
        proposeStateDelta: ({ participant }) => ({ by: participant.participantId })
      }
    });
    const started = await app.start({
      runId: 'run-architecture', topic: 'Система учёта заказов', models, draftPlan,
      policies: { finalization: { mode: 'manual' } }, maxSteps: 10
    });
    expect(started.ok).toBe(true);
    const executed = app.getOrchestrator().getState().stages.filter((stage) => stage.plannedStageId);
    expect(executed.map((stage) => [stage.plannedStageId, stage.participants.map((p) => p.participantId)])).toEqual([
      ['canvas-r1', ['Claude']],
      ['canvas-r2', models],
      ['canvas-r3', ['GPT']],
      ['canvas-r4', ['Claude']]
    ]);
    executed.forEach((stage) => {
      expect(stage.instruction).toBe(Framework.byNumber(Number(stage.plannedStageId.replace('canvas-r', ''))).instruction);
    });
    expect(prompts.length).toBeGreaterThan(0);
    prompts.forEach(({ prompt }) => expect(prompt).toMatch(/^STAGE .* FOR .*: Этап \d+\./));
  });
});
