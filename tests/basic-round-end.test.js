const Engine = require('../disput/custom-engine');
const Record = require('../disput/custom-run-record');
const Digest = require('../shared/report-digest');

const ok = (text) => ({ text, status: 'SUCCESS' });

describe('end of a round', () => {
  test('custom_step_end follows the decision of the owner, custom_step precedes it', async () => {
    const events = [];
    const send = async (models) => ({ byModel: Object.fromEntries(models.map((m) => [m, ok('ответ')])), closedByOwner: false });
    const steps = [{ ref: 'r1', kind: 'round', input: 'none', models: ['A'] }, { ref: 'owner:ok', kind: 'owner', input: 'previous', task: 'Решите' }];
    await Engine.run({ task: 'T', steps, send, semiAuto: true, provideOwnerResult: async () => 'ок',
      decide: async () => { events.push('decide'); return 'continue'; }, onEvent: (kind) => events.push(kind) });
    const first = events.filter((k) => k !== 'custom_answer');
    expect(first.indexOf('custom_step')).toBeLessThan(first.indexOf('decide'));
    expect(first.indexOf('decide')).toBeLessThan(first.indexOf('custom_step_end'));
    expect(events.filter((k) => k === 'custom_step_end')).toHaveLength(2);
  });

  test('Extract takes the round end from custom_step_end, and custom_step for an older journal', () => {
    const RUN = 'run-e';
    const at = (ms) => new Date(1700000000000 + ms).toISOString();
    const base = [
      { at: at(0), kind: 'custom_start', pipelineRunId: RUN, steps: [{ step: 0, label: 'R1', input: 'none', models: ['A'] }] },
      { at: at(100), kind: 'batch_start', batchId: `${RUN}:r1:g0`, stageId: Digest.customStageId(RUN, 0), models: ['A'], requestIds: { A: 'q1' } },
      { at: at(1000), kind: 'custom_step', pipelineRunId: RUN, step: 0, accepted: 1, failed: 0 }
    ];
    const duration = (journal) => Digest.customFlowReport({ runId: RUN, delivery: { journal } }).stageExecutions[0].durationMs;
    expect(duration(base)).toBe(900);
    expect(duration([...base, { at: at(5000), kind: 'custom_step_end', pipelineRunId: RUN, step: 0 }])).toBe(4900);
  });
});

describe('artifact address in the attempt input', () => {
  test('the record keeps the artifact and its address of an input item', () => {
    const record = Record.createRun({ runId: 'r', steps: [{ kind: 'round', models: ['A'] }] });
    const artifact = { lineage: { id: 'doc' }, source: { step: 'r1', participant: 'A', visit: 2 } };
    const address = { step: 'r1', participant: 'A', visit: 2, artifact: 'doc' };
    Record.recordAttempt(record, { step: 1, participant: 'B', model: 'B', attempt: 1, prompt: 'p',
      parts: { input: { mode: 'sources', items: [{ label: 'x', text: 'версия', source: { step: 0 }, artifact, address }, { label: 'y', text: 'z', source: { step: 0 } }] } } });
    const items = Record.exportRun(record).attempts[0].input.items;
    expect(items[0]).toMatchObject({ artifact, address, text: 'версия' });
    expect(items[1]).not.toHaveProperty('artifact');
  });
});
