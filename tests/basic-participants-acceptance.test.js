const Engine = require('../disput/custom-engine');
const Schema = require('../disput/basic-schema');
const RunRecord = require('../disput/custom-run-record');
const StageCard = require('../results/stage-card');

const models = ['Claude', 'GPT'];
const schema = (steps, extra = {}) => ({ schemaVersion: 2, origin: 'user', steps, ...extra });
const round = (ref, participants, extra = {}) => ({ ref, kind: 'round', models: participants, ...extra });

describe('Basic participant identities: format compatibility', () => {
  test('v1 remains valid without conversion and v1 still rejects v2-only participant fields', () => {
    const v1 = { schemaVersion: 1, origin: 'user', steps: [round('r1', [{ name: 'Claude' }])] };
    expect(Schema.validate(v1)).toEqual([]);
    expect(Schema.assemble(v1)[0].models[0]).toMatchObject({ name: 'Claude', id: 'Claude' });
    expect(v1.schemaVersion).toBe(1);

    const invalidV1 = { ...v1, steps: [round('r1', [{ name: 'Claude', label: 'Claude 2' }])] };
    expect(Schema.validate(invalidV1)).toContainEqual({ path: 'steps[0].models[0].label', message: 'неизвестное поле' });
  });

  test('v2 permits distinct IDs for one provider and preserves labels across canvas and settings projections', () => {
    const value = schema([
      round('r1', [
        { name: 'Claude', id: 'claude-main', label: 'Claude' },
        { name: 'Claude', id: 'claude-review', label: 'Claude 2', enabled: false, onCanvas: true }
      ]),
      round('r2', [{ name: 'Claude', id: 'claude-review', label: 'Claude 2' }])
    ]);

    expect(Schema.validate(value)).toEqual([]);
    const canvas = Schema.toCanvas(value, { models });
    expect(canvas.errors).toEqual([]);
    expect(canvas.stacks['r1-models'].items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'claude-main', name: 'Claude', label: 'Claude', send: true }),
      expect.objectContaining({ id: 'claude-review', name: 'Claude', label: 'Claude 2', send: false })
    ]));
    expect(canvas.rounds.map((item) => item.participantIds)).toEqual([['claude-main'], ['claude-review']]);

    const settings = Schema.toSettings(value);
    expect(settings.customModelSettings.r1['claude-review']).toMatchObject({ name: 'Claude', enabled: false, label: 'Claude 2' });
    expect(settings.customModelSettings.r2['claude-review']).toMatchObject({ name: 'Claude', label: 'Claude 2' });
  });

  test('references and outputs stay attached to the participant ID when provider names repeat', () => {
    const artifact = { format: 'json', requiredFields: ['/answer'], artifacts: [
      { id: 'answer', name: 'Answer', pointer: '/answer' }
    ] };
    const source = { artifact: { step: 'r1', participant: 'claude-review', id: 'answer' }, version: 'latest' };
    const value = schema([
      round('r1', [
        { name: 'Claude', id: 'claude-writer', label: 'Claude', output: artifact },
        { name: 'Claude', id: 'claude-review', label: 'Claude 2', output: artifact }
      ]),
      round('r2', [{ name: 'GPT', id: 'gpt-editor', input: [source] }])
    ]);

    expect(Schema.validate(value)).toEqual([]);
    expect(Schema.assemble(value).map((step) => step.models.map((model) => [model.id, model.name]))).toEqual([
      [['claude-writer', 'Claude'], ['claude-review', 'Claude']],
      [['gpt-editor', 'GPT']]
    ]);
    expect(Schema.assemble(value)[1].models[0].input).toEqual([source]);
  });

  test('an explicit-empty participant receives no inherited task, discipline or input', () => {
    const value = schema([round('r1', [
      { name: 'Claude', id: 'claude-main', label: 'Claude' },
      { name: 'Claude', id: 'claude-blank', label: 'Claude 2', settingsMode: 'explicit' }
    ], { input: 'previous', task: 'INHERITED ROUND TASK', output: { name: 'INHERITED OUTPUT', form: 'inherited format' } })], {
      defaults: {
        roundTask: 'INHERITED ROUND TASK',
        discipline: {
          limit: 'INHERITED LIMIT', content: 'INHERITED CONTENT', delivery: 'INHERITED DELIVERY',
          correction: 'INHERITED CORRECTION', lines: ['INHERITED LINE']
        }
      },
      run: { maxWords: 700, strictLength: true }
    });

    expect(Schema.validate(value)).toEqual([]);
    const step = Schema.assemble(value)[0];
    const participant = step.models.find((item) => item.id === 'claude-blank');
    expect(participant).toMatchObject({
      name: 'Claude', id: 'claude-blank', label: 'Claude 2', settingsMode: 'explicit',
      task: '', promptTemplate: null, maxWords: null, input: 'none',
      // The delivery mark and the correction request are never empty (NEVER_EMPTY): they come from the inherited layers.
      discipline: { limit: '', content: '', delivery: 'INHERITED DELIVERY', correction: 'INHERITED CORRECTION' }
    });
    expect(participant).not.toHaveProperty('output');
    expect(participant.discipline.lines).toBeUndefined();
    const prompt = Engine.buildPrompt({ task: 'MAIN TASK', step, model: participant, inputMode: 'none' });
    expect(prompt).toBe('Задача:\nMAIN TASK');
    expect(prompt).not.toMatch(/INHERITED|Объём ответа|слова/);
    const preview = Engine.previewPrompt({ task: 'MAIN TASK', steps: [step], stepIndex: 0, modelName: 'Claude', participantId: 'claude-blank' });
    expect(preview.inputMode).toBe('none');
    expect(preview.prompt).toBe('Задача:\nMAIN TASK');
    expect(Schema.resolveRun(value)).toEqual({ policy: 'manual', maxWords: 700, strictLength: true, stopMarks: [], onNoAnswer: 'ask', repeat: null });
  });

  test('preview selects a duplicated provider by participant ID rather than the first matching provider', () => {
    const value = schema([round('r1', [
      { name: 'Claude', id: 'claude-main', label: 'Claude', task: 'MAIN PARTICIPANT TASK' },
      { name: 'Claude', id: 'claude-blank', label: 'Claude 2', settingsMode: 'explicit', input: 'none' }
    ], { input: 'previous', task: 'INHERITED ROUND TASK' })]);
    const preview = Engine.previewPrompt({ task: 'MAIN TASK', steps: Schema.assemble(value), stepIndex: 0,
      modelName: 'Claude', participantId: 'claude-blank' });

    expect(preview.inputMode).toBe('none');
    expect(preview.prompt).toBe('Задача:\nMAIN TASK');
  });
});

describe('Basic participant transport identity', () => {
  test('round cards display the participant label while retaining the provider name for transport', () => {
    const card = StageCard.buildModel({ round: 1, participants: [
      { name: 'Claude', id: 'writer', label: 'Claude', send: true },
      { name: 'Claude', id: 'reviewer', label: 'Claude 2', send: false }
    ] });

    expect(card.participants).toEqual({ working: ['Claude'], waiting: ['Claude 2'] });
  });

  test('two participants using one provider keep separate IDs through engine dispatch and outcomes', async () => {
    const value = schema([round('r1', [
      { name: 'Claude', id: 'writer', label: 'Claude' },
      { name: 'Claude', id: 'reviewer', label: 'Claude 2' }
    ])]);
    const requestsByWave = [];
    const events = [];
    const result = await Engine.run({
      task: 'T', steps: Schema.assemble(value),
      sendParticipants: async (requests) => {
        requestsByWave.push(requests.map(({ participantId, modelName }) => ({ participantId, modelName })));
        return { byParticipant: Object.fromEntries(requests.map((request) => [request.participantId, {
          text: `answer ${request.participantId}`, status: 'SUCCESS'
        }])) };
      },
      onEvent: (kind, fields) => events.push({ kind, ...fields })
    });

    expect(requestsByWave).toEqual([[
      { participantId: 'writer', modelName: 'Claude' },
      { participantId: 'reviewer', modelName: 'Claude' }
    ]]);
    expect(result.steps[0].outcome).toMatchObject({
      writer: { ok: true, model: 'Claude', participant: 'writer' },
      reviewer: { ok: true, model: 'Claude', participant: 'reviewer' }
    });
    expect(events.filter((event) => event.kind === 'custom_answer').map((event) => event.participant)).toEqual(['writer', 'reviewer']);
  });

  test('a participant chat URL survives run checkpoint serialization and can be passed back for recovery', () => {
    const record = RunRecord.createRun({ runId: 'run-1', steps: [{ ref: 'r1', kind: 'round', models: ['Claude'] }] });
    RunRecord.setSnapshot(record, {
      schema: schema([round('r1', [{ name: 'Claude', id: 'claude-review', label: 'Claude 2' }])]),
      state: { pc: 'r1', visits: {}, results: [], decisions: {}, chatBindings: {} }
    });
    const binding = {
      modelName: 'Claude', tabId: 44,
      initialUrl: 'https://claude.ai/new', chatUrl: 'https://claude.ai/chat/abc123'
    };
    expect(RunRecord.setChatBindings(record, { 'claude-review': binding })).toBe(true);
    const resumed = RunRecord.revive(RunRecord.serialize(record));
    expect(resumed.snapshot.chatBindings['claude-review']).toEqual(binding);
  });
});
