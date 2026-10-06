// "Исследование" template: the 15-stage catalogue written from docs/scenarios/research-2.0.md,
// reached through the stage-template registry next to the Architecture template.
const fs = require('fs');
const path = require('path');
const Framework = require('../disput/research-framework');
const Architecture = require('../disput/architecture-framework');
const Templates = require('../disput/stage-templates');
const Markers = require('../disput/stage-markers');
const StageCard = require('../results/stage-card');
const DraftPlan = require('../disput/debate-draft-plan');
const Presets = require('../disput/pipeline-presets');

const read = (name) => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const PHASE_KEYS = Object.keys(Framework.PHASES);

describe('stage template registry', () => {
  test('names map to frameworks; unknown names map to nothing', () => {
    expect(Templates.names()).toEqual(['architecture', 'research']);
    expect(Templates.get('architecture')).toBe(Architecture);
    expect(Templates.get('Research')).toBe(Framework);
    expect(Templates.get('')).toBeNull();
    expect(Templates.get('nothing')).toBeNull();
    expect(Templates.has('research')).toBe(true);
  });

  test('the panel asks the registry; no page code names a framework directly', () => {
    const source = read('results.js');
    expect(source).not.toContain('window.ArchitectureFramework');
    expect(source).toContain('window.StageTemplates?.get?.(activeStageTemplate)');
    const html = read('pipeline_panel.html');
    ['architecture-framework.js', 'research-framework.js', 'stage-templates.js'].forEach((file) => expect(html).toContain(`disput/${file}`));
  });
});

describe('research framework catalogue', () => {
  test('15 numbered stages; three moderator gates G1-G3; a brief for each', () => {
    expect(Framework.STAGES.map((stage) => stage.n)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    expect(Framework.STAGES.filter((stage) => stage.who === 'gate').map((stage) => [stage.n, stage.gate])).toEqual([[3, 'G1'], [11, 'G2'], [15, 'G3']]);
    Framework.STAGES.forEach((stage) => {
      expect(stage.titleRu).toBeTruthy();
      expect(PHASE_KEYS).toContain(stage.phase);
      expect(stage.instruction).toContain(`Этап ${stage.n}.`);
      expect(stage.instruction).toContain(stage.titleRu);
    });
  });

  test('the stage before a gate carries gateAfter', () => {
    expect(Framework.STAGES.filter((stage) => stage.gateAfter).map((stage) => [stage.n, stage.gateAfter])).toEqual([[2, 'G1'], [10, 'G2'], [14, 'G3']]);
  });

  test('purposes are ones the engine already runs in the Architecture template', () => {
    const used = new Set(Architecture.STAGES.map((stage) => stage.purpose));
    Framework.STAGES.forEach((stage) => expect(used.has(stage.purpose)).toBe(true));
  });

  test('independent stages are the splits and the collection; they forbid peeking', () => {
    expect(Framework.STAGES.filter((stage) => stage.independent).map((stage) => stage.n)).toEqual([4, 7]);
    [4, 7].forEach((n) => {
      expect(Framework.byNumber(n)).toMatchObject({ who: 'all', purpose: 'position' });
      expect(Framework.byNumber(n).instruction).toContain('Этап независимый');
    });
  });

  test('who works: all, the lead, a reviewer other than the lead, nobody at a gate', () => {
    const models = ['Claude', 'GPT', 'Gemini'];
    expect(Framework.participantsFor(Framework.byNumber(4), models)).toEqual(models);
    expect(Framework.participantsFor(Framework.byNumber(1), models)).toEqual(['Claude']);
    expect(Framework.participantsFor(Framework.byNumber(9), models)).toEqual(['GPT']);
    expect(Framework.participantsFor(Framework.byNumber(9), ['Claude'])).toEqual(['Claude']);
    expect(Framework.participantsFor(Framework.byNumber(3), models)).toEqual([]);
    // The report is written by the lead and critiqued by someone else.
    expect(Framework.participantsFor(Framework.byNumber(12), models)).not.toEqual(Framework.participantsFor(Framework.byNumber(13), models));
  });

  test('the rules of the scenario are in the briefs that need them', () => {
    expect(Framework.byNumber(9).instruction).toContain('«принято» без цитаты');
    expect(Framework.byNumber(9).instruction).toContain('Битая ссылка опровергает доказательство, а не факт');
    expect(Framework.byNumber(7).instruction).toContain('Придумывать ссылки');
    expect(Framework.byNumber(5).instruction).toContain('не больше 8');
    expect(Framework.byNumber(10).instruction).toContain('Решать по большинству моделей');
    expect(Framework.byNumber(12).instruction).toContain('Повышать степень уверенности');
    expect(Framework.byNumber(14).instruction).toContain('самый ранний этап');
  });

  test('review stages get the VERDICT marker and every model stage may ask the owner with options', () => {
    ['critique', 'verification', 'evidence_review'].forEach((purpose) => {
      expect(Framework.STAGES.some((stage) => stage.purpose === purpose)).toBe(true);
      expect(Markers.instructions({ purpose })).toContain('[[VERDICT: pass]]');
    });
    expect(Markers.instructions({ purpose: 'position' })).toContain('[[ASK: вопрос || вариант 1 || вариант 2]]');
  });
});

describe('research template in the pipeline', () => {
  test('the built-in Research pipeline uses the template with 15 rounds', () => {
    const definition = Presets.BUILTIN_PIPELINE_DEFINITIONS.find((item) => item.name === 'Research');
    expect(definition).toMatchObject({ presetId: 'UNIVERSAL_RESEARCH', roundLimit: '15', stageTemplate: 'research', runPolicy: 'auto' });
    expect(Presets.normalizePipelinePreset('UNIVERSAL_RESEARCH', { currentUiLimits: { maxTotalStages: 15 } })).toMatchObject({ maxTotalStages: 15 });
  });

  test('the draft plan keeps instruction and meta; gates are not planned', () => {
    const rounds = Framework.STAGES.filter((stage) => stage.who !== 'gate').slice(0, 4).map((stage) => ({
      plannedStageId: `canvas-r${stage.n}`, label: `${stage.n}. ${stage.titleRu}`, purpose: stage.purpose,
      instruction: stage.instruction, meta: { stageTemplate: 'research', stageNumber: stage.n, ...(stage.gateAfter ? { gateAfter: stage.gateAfter } : {}) },
      participantIds: ['Claude']
    }));
    const plan = DraftPlan.createCanvasPlan({ rounds: [...rounds, { plannedStageId: 'canvas-r3', participantIds: [] }] });
    expect(plan.plannedStages.length).toBe(4);
    expect(plan.plannedStages[0]).toMatchObject({ plannedStageId: 'canvas-r1', instruction: rounds[0].instruction, meta: { stageNumber: 1 } });
    expect(DraftPlan.validate(plan).valid).toBe(true);
  });

  test('the stage card shows a research stage and a gate', () => {
    const stage = StageCard.buildModel({ round: 7, templateStage: Framework.byNumber(7), participants: [{ name: 'Claude', send: true }, { name: 'GPT', send: true }] });
    expect(stage.title).toBe('Этап 7 · Сбор материалов');
    expect(stage.subtitle).toBe('Материал · Evidence Collection');
    expect(stage.badges).toEqual(expect.arrayContaining(['независимый', 'позиция', 'все модели независимо']));
    const gate = StageCard.buildModel({ round: 11, templateStage: Framework.byNumber(11), participants: [{ name: 'Claude', send: false }] });
    expect(gate.status.code).toBe('gate');
    expect(gate.badges).toEqual(expect.arrayContaining(['ворота G2']));
  });
});
