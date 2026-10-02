// Field report (8): Le Chat appends the time after the delivery token ("[[AO-…]] 8:55pm"). The token
// was stripped, "…8:55pm" read as a cut-off ending, every answer was rejected (3 model calls per
// stage) and the stage failed. Fix: drop provider chrome after the token; a transport-complete
// answer is not "incomplete"; every rejection is journaled with its reason.
const Delivery = require('../shared/message-delivery');
const Acceptance = require('../disput/debate-response-acceptance');
const Diagnosis = require('../shared/message-delivery-diagnosis');
const Application = require('../disput/debate-application');
const DraftPlan = require('../disput/debate-draft-plan');

const BODY = 'Это содержательный ответ модели, который заканчивается обычным предложением.';

describe('provider chrome after the delivery token', () => {
  test('a short tail on the token line is dropped, the answer stays intact', () => {
    expect(Delivery.clean(`${BODY}\n[[AO-atc9p3]] 8:55pm`)).toBe(BODY);
    expect(Delivery.clean(`${BODY} [[AO-atc9p3]] 8:55pm`)).toBe(BODY);
    expect(Delivery.clean(`${BODY}\n[[AO-atc9p3]]`)).toBe(BODY);
  });

  test('text on other lines, and tokens that are not the answer end, are not touched', () => {
    const multi = `Первый абзац.\n[[AO-atc9p3]] 8:55pm\nВторой абзац остаётся.`;
    expect(Delivery.clean(multi)).toBe('Первый абзац.\n\nВторой абзац остаётся.');
    expect(Delivery.clean(`${BODY} [[AO-atc9p3]] ${'очень длинный хвост '.repeat(5)}`)).toContain('очень длинный хвост');
  });
});

describe('the ending check needs proof only when the transport gave none', () => {
  const unfinished = 'Конец ответа без знака препинания и без тайм штампа вообще нет';

  test('without proof an unfinished last line is rejected; with a complete completion it is accepted', () => {
    expect(Acceptance.evaluate({ text: unfinished, meta: {} })).toMatchObject({ ok: false, reason: 'incomplete_ending' });
    expect(Acceptance.evaluate({ text: unfinished, meta: { completion: 'partial' } })).toMatchObject({ ok: false, reason: 'incomplete_ending' });
    expect(Acceptance.evaluate({ text: unfinished, meta: { completion: 'complete' } }).ok).toBe(true);
  });

  test('other rules still apply to a complete answer (empty, too long)', () => {
    expect(Acceptance.evaluate({ text: '', meta: { completion: 'complete' } }).reason).toBe('empty');
    expect(Acceptance.evaluate({ text: 'слово '.repeat(50).trim(), meta: { completion: 'complete', maxWords: 10 } }).reason).toBe('too_long');
  });
});

describe('engine: rejections are journaled; a proven answer is accepted at once', () => {
  const run = async (completion) => {
    const rejected = [];
    const calls = [];
    const app = Application.createApplication({
      universalEngine: true, allowIncompleteWiring: true, exposeInternals: true,
      deps: {
        runModelBatch: async ({ models }) => {
          calls.push(models.slice());
          return { responses: Object.fromEntries(models.map((model) => [model, 'Ответ без точки в конце 8:55pm'])), results: Object.fromEntries(models.map((model) => [model, { completion }])), failed: {} };
        },
        acceptResponse: (text, meta) => Acceptance.evaluate({ text, meta: { ...meta } }),
        proposeStateDelta: ({ participant }) => ({ by: participant.participantId }),
        onResponseRejected: (info) => rejected.push(info)
      }
    });
    await app.start({
      runId: 'run-tail', topic: 't', models: ['A'], policies: { finalization: { mode: 'manual' } }, maxSteps: 5,
      draftPlan: DraftPlan.createCanvasPlan({ rounds: [{ plannedStageId: 'canvas-r1', purpose: 'position', participantIds: ['A'] }] })
    });
    return { rejected, calls, state: app.getOrchestrator().getState() };
  };

  test('complete → accepted with one call, nothing rejected', async () => {
    const { rejected, calls, state } = await run('complete');
    expect(calls).toHaveLength(1);
    expect(rejected).toEqual([]);
    expect(state.stages[0].status).toBe('completed');
  });

  test('no proof → rejected; every attempt reports its reason, the stage fails and stops', async () => {
    const { rejected, state } = await run(null);
    expect(rejected.length).toBeGreaterThanOrEqual(2);
    rejected.forEach((info) => expect(info).toMatchObject({ type: 'PARTICIPANT_RESPONSE_REJECTED', participantId: 'A', reason: 'incomplete_ending' }));
    expect(state.lifecycle).toBe('PAUSED');
    expect(state.pauseInfo.reason).toBe('stage_failed');
  });
});

describe('delivery report', () => {
  const T0 = Date.parse('2026-10-02T05:11:00.000Z');
  const at = (s) => new Date(T0 + s * 1000).toISOString();

  test('rejections are grouped per model and reason, with the count', () => {
    const journal = [
      { at: at(10), kind: 'response_rejected', model: 'Le Chat', stage: 'stage-1', attempt: 1, reason: 'incomplete_ending', chars: 2800 },
      { at: at(25), kind: 'response_rejected', model: 'Le Chat', stage: 'stage-1', attempt: 2, reason: 'incomplete_ending', chars: 2790 },
      { at: at(50), kind: 'response_rejected', model: 'Le Chat', stage: 'stage-2', attempt: 1, reason: 'incomplete_ending', chars: 3000 },
      { at: at(60), kind: 'response_rejected', model: 'GPT', stage: 'stage-2', attempt: 1, reason: 'too_long', chars: 9000 }
    ];
    const problems = Diagnosis.diagnose(journal, { now: T0 + 100000 }).problems.filter((p) => p.code === 'response_rejected');
    expect(problems).toHaveLength(2);
    const lechat = problems.find((p) => p.model === 'Le Chat');
    expect(lechat).toMatchObject({ severity: 'warning', count: 3 });
    expect(lechat.reason).toBe('incomplete_ending ×3 · этапов: 2');
    expect(problems.find((p) => p.model === 'GPT').reason).toBe('too_long ×1 · этапов: 1');
  });
});
