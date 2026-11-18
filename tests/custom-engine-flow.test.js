const Engine = require('../disput/custom-engine');

// A scripted transport (as in custom-engine.test.js): answers[model] is a list of replies, one per request to that model.
function transport(answers) {
  const calls = [];
  const used = {};
  const send = async (models, prompts, meta) => {
    calls.push({ models: models.slice(), prompts: { ...prompts }, meta });
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = typeof reply === 'object' ? reply : { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, calls };
}

const r1 = { ref: 'r1', kind: 'round', input: 'none', models: ['A'] };
// A check is an ordinary round: its criteria are in the task, and its answer is an answer like any other.
const check = { ref: 'r2', kind: 'round', task: 'Проверь по критериям: полнота. Перечисли невыполненные.', models: ['B'] };
const decision = { ref: 'owner:ok', kind: 'owner', input: 'previous', task: 'Прочитайте проверку и решите, что делать дальше' };
const r3 = { ref: 'r3', kind: 'round', input: 'all', models: ['C'] };

describe('Custom engine: a linear run of rounds and an owner step (no branches, no transitions)', () => {
  test('the steps run in their order; the owner decides by its answer, the next round reads it', async () => {
    const { send, calls } = transport({ A: ['карта'], B: ['не выполнено: полнота'], C: ['итог'] });
    const events = [];
    const result = await Engine.run({ task: 'T', steps: [r1, check, decision, r3], send,
      provideOwnerResult: async () => 'Доработать раздел о сроках', onEvent: (kind) => events.push(kind) });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'C']);
    expect(result.steps.map((step) => [step.ref, step.visit])).toEqual([['r1', 1], ['r2', 1], ['owner:ok', 1], ['r3', 1]]);
    expect(calls[2].prompts.C).toContain('Доработать раздел о сроках');
    expect(events.some((kind) => /gate|route|transition/.test(kind))).toBe(false);
    expect(result.state.visits).toEqual({ r1: 1, r2: 1, 'owner:ok': 1, r3: 1 });
    ['loopCounters', 'continuationStack', 'feedback', 'dependencies', 'routes'].forEach((field) => expect(result.state).not.toHaveProperty(field));
  });

  test('a technical retry of an answer keeps its visit; only the attempt counts up', async () => {
    const { send, calls } = transport({ A: ['', 'карта'], B: ['проверка'] });
    await Engine.run({ task: 'T', steps: [r1, check], send });
    expect(calls[0].meta).toMatchObject({ attempt: 1, visit: 1 });
    expect(calls[1].meta).toMatchObject({ attempt: 2, visit: 1 });
  });

  test('a gate or a route step is refused before the first request: the engine does not execute these kinds', async () => {
    const removed = [
      { ref: 'gate:g1', kind: 'gate', criteria: ['полнота'], models: ['B'], onFail: { goto: 'r3' } },
      { ref: 'route:x', kind: 'route', models: [], select: { by: 'owner', cases: [{ id: 'a', label: 'A', action: { goto: 'r3' } }] } }
    ];
    for (const step of removed) {
      const { send, calls } = transport({ A: ['a'], B: ['b'], C: ['c'] });
      const error = await Engine.run({ task: 'T', steps: [r1, step, r3], send }).catch((item) => item);
      expect(error).toBeInstanceOf(Engine.EngineError);
      expect(error.code).toBe('unsupported_kind');
      expect(error.message).toContain(step.kind);
      expect(calls).toHaveLength(0);
    }
  });
});

// run.stopMarks: the run stops after the step whose accepted answer has a line that starts with a mark (the step is kept).
describe('Custom engine: run.stopMarks stops the run by a mark at the start of a line of an accepted answer', () => {
  const MARKS = ['ТРЕВОГА:', 'СТОП:'];
  const r2 = { ref: 'r2', kind: 'round', input: 'previous', models: ['B'] };
  const steps = [r1, r2, r3];

  test('a mark at the start of a line of the second step stops the run; the second step is kept, the third is not sent', async () => {
    const { send, calls } = transport({ A: ['карта'], B: ['Проверка\nТРЕВОГА: карта пуста\nдальше'], C: ['итог'] });
    const result = await Engine.run({ task: 'T', steps, send, stopMarks: MARKS });
    expect(result.stopReason).toBe('stop_mark');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B']);
    expect(result.steps.map((step) => step.ref)).toEqual(['r1', 'r2']);
    expect(result.stopDetail).toContain('r2');
    expect(result.stopDetail).toContain('ТРЕВОГА: карта пуста');
    expect(Engine.STOP_TEXT.stop_mark).toBe('остановлено по метке в ответе');
  });

  test('the markup around a mark does not hide it: bold, a quote, a heading', async () => {
    for (const reply of ['**ТРЕВОГА:** пусто', '> СТОП: цикл', '## ТРЕВОГА: x']) {
      const { send, calls } = transport({ A: ['карта'], B: [reply], C: ['итог'] });
      const result = await Engine.run({ task: 'T', steps, send, stopMarks: MARKS });
      expect(result.stopReason).toBe('stop_mark');
      expect(calls).toHaveLength(2);
    }
  });

  test('a mark inside a line, or in another case, does not stop the run', async () => {
    const { send, calls } = transport({ A: ['карта'], B: ['Нет ТРЕВОГА: здесь\nтревога: строчными'], C: ['итог'] });
    const result = await Engine.run({ task: 'T', steps, send, stopMarks: MARKS });
    expect(result.stopReason).toBe('steps_done');
    expect(calls).toHaveLength(3);
  });

  test('without stopMarks the same answer does not stop the run', async () => {
    const { send, calls } = transport({ A: ['карта'], B: ['ТРЕВОГА: пусто'], C: ['итог'] });
    const result = await Engine.run({ task: 'T', steps, send });
    expect(result.stopReason).toBe('steps_done');
    expect(calls).toHaveLength(3);
  });

  test('a mark in a rejected answer does not stop the run: the retry gives a clean answer', async () => {
    const { send, calls } = transport({ A: ['карта'], B: ['ТРЕВОГА: пусто', 'проверка'], C: ['итог'] });
    // The check of the answer rejects the first reply (the mark is in it); the retry is the next reply.
    const accept = ({ text: value }) => ({ ok: !value.includes('ТРЕВОГА') });
    const result = await Engine.run({ task: 'T', steps, send, stopMarks: MARKS, accept });
    expect(result.stopReason).toBe('steps_done');
    expect(calls.map((call) => call.models[0])).toEqual(['A', 'B', 'B', 'C']);
  });

  test('a run stopped by a mark resumes from the next step and does not check the stopped step again', async () => {
    let saved = null;
    const data = {};
    let seq = 0;
    const texts = { putText: (value) => { seq += 1; data[`t${seq}`] = value; return `t${seq}`; }, getText: (ref) => data[ref] };
    const first = transport({ A: ['карта'], B: ['ТРЕВОГА: пусто'], C: ['итог'] });
    const run1 = await Engine.run({ task: 'T', steps, send: first.send, stopMarks: MARKS, ...texts, checkpoint: async (state) => { saved = JSON.parse(JSON.stringify(state)); } });
    expect(run1.stopReason).toBe('stop_mark');
    const second = transport({ C: ['итог'] });
    const run2 = await Engine.run({ task: 'T', steps, send: second.send, stopMarks: MARKS, ...texts, resume: saved });
    expect(run2.stopReason).toBe('steps_done');
    expect(second.calls.map((call) => call.models[0])).toEqual(['C']);
  });
});

describe('Custom engine: findStopMark', () => {
  const { findStopMark } = Engine;

  test('an empty text, no marks, no line with a mark: nothing is found', () => {
    expect(findStopMark('', ['ТРЕВОГА:'])).toBeNull();
    expect(findStopMark('текст', [])).toBeNull();
    expect(findStopMark('текст\nещё', ['ТРЕВОГА:'])).toBeNull();
    expect(findStopMark(undefined, ['ТРЕВОГА:'])).toBeNull();
  });

  test('the first line that starts with a mark wins, whatever the order of the marks in the list', () => {
    expect(findStopMark('СТОП: a\nТРЕВОГА: b', ['ТРЕВОГА:', 'СТОП:'])).toEqual({ mark: 'СТОП:', line: 'СТОП: a' });
    expect(findStopMark('  ТРЕВОГА: b\n', ['ТРЕВОГА:'])).toEqual({ mark: 'ТРЕВОГА:', line: 'ТРЕВОГА: b' });
  });

  test('the comparison is by case, and the markup of a line is not part of the mark', () => {
    expect(findStopMark('тревога: x', ['ТРЕВОГА:'])).toBeNull();
    expect(findStopMark('*ТРЕВОГА:* x', ['ТРЕВОГА:'])).toMatchObject({ mark: 'ТРЕВОГА:' });
    expect(findStopMark('• ТРЕВОГА: x', ['ТРЕВОГА:'])).toMatchObject({ mark: 'ТРЕВОГА:' });
  });
});
