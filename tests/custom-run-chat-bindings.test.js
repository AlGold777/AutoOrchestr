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

describe('B01: Chat bindings preservation on stop/final snapshot (T07, 8.2)', () => {
  test('B01: final snapshot on stop preserves page chatBindings when engine result.state lacks them', () => {
    const record = Record.createRun({ runId: 'chat-stop-b01', pipelineName: 'P', task: 'T', steps: TWO_ROUNDS });
    const pageBindings = {
      A: { modelName: 'A', stepRef: 'S1', visit: 1, transportRequestId: 'A-1', tabId: 101, requestId: 'req-A', stageAttemptId: 'stage-1' },
      B: { modelName: 'B', stepRef: 'S2', visit: 1, transportRequestId: 'B-1', tabId: 102, requestId: 'req-B', stageAttemptId: 'stage-2' }
    };
    // Page has saved chatBindings with tabId into snapshot (via checkpoint or setChatBindings)
    Record.setSnapshot(record, { schema: TWO_ROUNDS, state: { pc: 'S2', chatBindings: pageBindings } });
    expect(record.snapshot.chatBindings).toEqual(pageBindings);

    // Engine run ends/stops, producing result.state without page chatBindings (empty or missing tabId)
    const engineResultState = {
      pc: 'S2',
      visits: { S1: 1, S2: 1 },
      decisions: {},
      results: []
    };

    // Final snapshot on stop (simulating line ~7313) must not wipe out the page chatBindings
    Record.setSnapshot(record, { schema: TWO_ROUNDS, state: engineResultState });

    expect(record.snapshot.chatBindings).toEqual(pageBindings);
    const revived = Record.revive(clone(Record.serialize(record)));
    expect(revived.snapshot.chatBindings).toEqual(pageBindings);
  });

  test('B01: stop during run retains in-flight bindings and tabId when final snapshot is applied', async () => {
    const record = Record.createRun({ runId: 'chat-stop-inflight', pipelineName: 'P', task: 'T', steps: TWO_ROUNDS });
    const pageBindings = {
      A: { modelName: 'A', stepRef: 'S1', visit: 1, transportRequestId: 'A-1', tabId: 101, requestId: 'req-A', stageAttemptId: 'stage-1' },
      B: { modelName: 'B', stepRef: 'S2', visit: 1, tabId: 102, requestId: 'req-B', stageAttemptId: 'stage-2' }
    };
    Record.setSnapshot(record, { schema: TWO_ROUNDS, state: { pc: 'S1', chatBindings: pageBindings } });

    const controller = new AbortController();
    const runResult = await Engine.run({
      task: 'T', steps: TWO_ROUNDS, signal: controller.signal,
      putText: (value) => record.put(value), getText: (ref) => (ref && record.texts[ref] !== undefined ? record.texts[ref] : undefined),
      sendParticipants: transportBy({ A: ['a1'] }, { abortFor: 'B', controller })
    });
    expect(runResult.stopReason).toBe('cancelled');

    // Engine result.state only has minimal bindings without tabId and misses in-flight B
    Record.setSnapshot(record, { schema: TWO_ROUNDS, state: runResult.state });

    expect(record.snapshot.chatBindings.A).toMatchObject({ tabId: 101, modelName: 'A' });
    expect(record.snapshot.chatBindings.B).toMatchObject({ tabId: 102, modelName: 'B' });
  });

  test('B01: results.js passes page chatBindings to setSnapshot on finish/stop (line ~7313)', () => {
    const fs = require('fs');
    const path = require('path');
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    // In checkpointRecord (line ~7026), chatBindings is explicitly preserved in state:
    expect(resultsSource).toContain('state: { ...state, chatBindings: { ...chatBindings } }');
    // On stop/finish (line ~7313), CustomRecord.setSnapshot must also preserve chatBindings:
    const finishSnapshotSnippet = resultsSource.match(/CustomRecord\.setArtifacts\(record, [\s\S]*?CustomRecord\.finishRun/)?.[0] || '';
    expect(finishSnapshotSnippet).toContain('chatBindings');
  });

  test('B01 / 5.A: snapshot after final contains all known binding fields from before final', () => {
    const record = Record.createRun({ runId: 'chat-fields-5a', pipelineName: 'P', task: 'T', steps: TWO_ROUNDS });
    const fullBinding = {
      modelName: 'A',
      stepRef: 'S1',
      visit: 1,
      transportRequestId: 'A-1',
      tabId: 555,
      requestId: 'req-555',
      stageAttemptId: 'stage-custom:s1:a1',
      chatVisit: 1,
      attachedChatVisit: 1
    };
    Record.setSnapshot(record, { schema: TWO_ROUNDS, state: { pc: 'S1', chatBindings: { A: fullBinding } } });

    // Final state from engine has partial/new outcome without browser-level binding fields
    const finalEngineState = {
      pc: 'S2',
      visits: { S1: 1, S2: 1 },
      decisions: {},
      results: [],
      chatBindings: { A: { modelName: 'A', stepRef: 'S1', visit: 1, transportRequestId: 'A-1' } }
    };
    Record.setSnapshot(record, { schema: TWO_ROUNDS, state: finalEngineState });

    // All known binding fields must be present in snapshot after final
    expect(record.snapshot.chatBindings.A).toEqual(fullBinding);
  });

  test('B01 / 5.A: error on resume updates record stopReason to error even if record was previously finished', () => {
    const fs = require('fs');
    const path = require('path');
    const resultsSource = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

    // On resume / run start, finishedAt and stopReason are reset for active execution
    expect(resultsSource).toMatch(/const record = resumeRecord \|\|[\s\S]*?if \(record\) \{\s*record\.finishedAt = null;\s*record\.stopReason = '';\s*\}/);

    // In runCustomFromPage catch block, finishRun is called unconditionally for record with stopReason 'error'
    const runFn = resultsSource.slice(resultsSource.indexOf('const runCustomFromPage ='), resultsSource.indexOf('const startDebateFromPage ='));
    const catchBlock = runFn.slice(runFn.indexOf('} catch (err) {'));
    expect(catchBlock).toContain("window.CustomRunRecord.finishRun(record, { stopReason: 'error' })");
    expect(catchBlock).not.toContain('if (record && !record.finishedAt)');
  });
});

