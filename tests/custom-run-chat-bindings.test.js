const Engine = require('../disput/custom-engine');
const Record = require('../disput/custom-run-record');

const clone = (value) => JSON.parse(JSON.stringify(value));
const TWO_ROUNDS = [
  { ref: 'S1', kind: 'round', input: 'none', models: ['A'] },
  { ref: 'S2', kind: 'round', input: 'previous', models: ['B'] }
];

// A transport by participants; every reply carries a transport request ID (as the page gives it).
function transportBy(answers, { abortFor = null, controller = null } = {}) {
  const used = {};
  return async (requests) => {
    if (abortFor && requests.some((request) => request.participantId === abortFor)) {
      controller.abort();
      throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    }
    const byParticipant = {};
    requests.forEach((request) => {
      const index = used[request.participantId] || 0;
      used[request.participantId] = index + 1;
      const text = (answers[request.participantId] || [])[index] || '';
      byParticipant[request.participantId] = { text, status: 'SUCCESS', transportRequestId: `${request.participantId}-${index + 1}` };
    });
    return { byParticipant, closedByOwner: false };
  };
}

// The first run of a record: A answers, the request of B is in flight when Stop comes. The record holds the texts.
async function stoppedRecord(runId) {
  const record = Record.createRun({ runId, pipelineName: 'P', task: 'T', steps: TWO_ROUNDS });
  const controller = new AbortController();
  const states = [];
  const run1 = await Engine.run({
    task: 'T', steps: TWO_ROUNDS, signal: controller.signal,
    putText: (value) => record.put(value), getText: (ref) => (ref && record.texts[ref] !== undefined ? record.texts[ref] : undefined),
    checkpoint: async (state) => { states.push(clone(state)); },
    sendParticipants: transportBy({ A: ['a1'] }, { abortFor: 'B', controller })
  });
  expect(run1.stopReason).toBe('cancelled');
  Record.setSnapshot(record, { schema: TWO_ROUNDS, state: states[states.length - 1] });
  return { record, revived: Record.revive(clone(Record.serialize(record))) };
}

const resumeOf = (revived, snapshot = revived.snapshot) => ({
  task: 'T', steps: TWO_ROUNDS, resume: { ...clone(snapshot), artifacts: [] },
  putText: (value) => revived.put(value), getText: (ref) => (ref && revived.texts[ref] !== undefined ? revived.texts[ref] : undefined),
  sendParticipants: transportBy({ B: ['b1'] }), resolveUnknown: async () => 'resend'
});

describe('Custom run chat bindings (T07, 8.2)', () => {
  test('a checkpoint keeps the chat of each participant; a reload gives them back; a resume keeps them', async () => {
    const { record, revived } = await stoppedRecord('chat-1');
    const bindingA = { modelName: 'A', stepRef: 'S1', visit: 1, transportRequestId: 'A-1' };
    expect(record.snapshot.chatBindings).toEqual({ A: bindingA });
    expect(revived.snapshot.chatBindings).toEqual({ A: bindingA });
    expect(Record.exportRun(revived).snapshot.chatBindings).toEqual({ A: bindingA });
    const run2 = await Engine.run(resumeOf(revived));
    expect(run2.stopReason).toBe('steps_done');
    expect(run2.state.chatBindings).toEqual({ A: bindingA, B: { modelName: 'B', stepRef: 'S2', visit: 1, transportRequestId: 'B-1' } });
  });

  test('the snapshot copies the bindings: a later change of the state does not change the record', () => {
    const record = Record.createRun({ runId: 'copy', pipelineName: 'P', task: 'T', steps: [] });
    const state = { pc: null, chatBindings: { A: { modelName: 'A', stepRef: 'S1', visit: 1, transportRequestId: 'x' } } };
    Record.setSnapshot(record, { state });
    state.chatBindings.A.transportRequestId = 'changed';
    expect(record.snapshot.chatBindings.A.transportRequestId).toBe('x');
  });

  test('no bindings give an empty object; an old snapshot with a list reads without error and resumes', async () => {
    const { revived } = await stoppedRecord('chat-old');
    const oldSnapshot = { ...clone(revived.snapshot), chatBindings: [] };
    const reread = Record.revive(clone({ ...Record.serialize(revived), snapshot: oldSnapshot }));
    expect(Record.canResume(reread)).toBe(true);
    const run = await Engine.run(resumeOf(reread));
    expect(run.stopReason).toBe('steps_done');
    expect(run.state.chatBindings.B).toMatchObject({ modelName: 'B', transportRequestId: 'B-1' });
  });
});
