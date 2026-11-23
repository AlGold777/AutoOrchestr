const Engine = require('../disput/custom-engine');

// A scripted transport: answers[model] is a list of replies, one per request to that model.
function transport(answers, counter = { calls: 0 }) {
  const used = {};
  const send = async (models) => {
    counter.calls += 1;
    const byModel = {};
    models.forEach((model) => {
      const index = used[model] || 0;
      used[model] = index + 1;
      const reply = (answers[model] || [])[index];
      byModel[model] = { text: reply || '', status: reply ? 'SUCCESS' : 'TIMEOUT' };
    });
    return { byModel, closedByOwner: false };
  };
  return { send, counter };
}

// The owner's replies, one per call; null when there are none left (the owner cancels).
function owner(replies) {
  let index = 0;
  return async () => {
    const reply = replies[index];
    index += 1;
    return reply === undefined ? null : reply;
  };
}

function texts() {
  const map = new Map();
  let seq = 0;
  return {
    putText: (value) => { seq += 1; const ref = `t${seq}`; map.set(ref, value); return ref; },
    getText: (ref) => map.get(ref),
  };
}

const clone = (value) => JSON.parse(JSON.stringify(value));
const ROUND = (extra = {}) => ({ ref: 'r1', kind: 'round', models: ['A'], ...extra });
const ROUND2 = (extra = {}) => ({ ref: 'r2', kind: 'round', models: ['A'], ...extra });
const READ = { document: 'read', artifacts: [{ id: 'spec', name: 'ТЗ', pointer: '' }] };
const OWNER_DOC = (extra = {}) => ({ ref: 'owner:u', kind: 'owner', task: 'Уточните', document: 'r1', ...extra });

describe('Basic End window: the engine (Шаг End, provideEnd)', () => {
  test('without provideEnd nothing changes: no End events, the run ends as before', async () => {
    const events = [];
    const checkpoints = [];
    const { send } = transport({ A: ['первый', 'второй'] });
    const result = await Engine.run({ task: 'T', steps: [ROUND(), ROUND2()], send,
      onEvent: (kind, fields) => events.push({ event: kind, ...fields }), checkpoint: (state) => { checkpoints.push(state); } });
    expect(result.stopReason).toBe('steps_done');
    expect(result.answers).toEqual(['второй']);
    expect(events.some((item) => item.waitKind === 'end')).toBe(false);
    expect(checkpoints[checkpoints.length - 1].pendingOwner).toBeNull();
  });

  test('default items: the accepted answers of the last round with answers', async () => {
    const { send } = transport({ A: ['первый', 'второй'] });
    const seen = [];
    const result = await Engine.run({ task: 'T', steps: [ROUND(), ROUND2()], send, provideEnd: async (request) => { seen.push(request); return null; } });
    expect(result.stopReason).toBe('steps_done');
    expect(seen.length).toBe(1);
    expect(seen[0].stopReason).toBe('steps_done');
    expect(seen[0].items).toEqual([expect.objectContaining({ step: 'r2', participant: 'A', version: 1, text: 'второй' })]);
    expect(typeof seen[0].items[0].title).toBe('string');
  });

  test('explicit end: the given sources, one participant of a round', async () => {
    const { send } = transport({ A: ['a1'], B: ['b1'] });
    const seen = [];
    await Engine.run({ task: 'T', steps: [ROUND({ models: ['A', 'B'] }), ROUND2()], send,
      end: [{ step: 'r1', participant: 'B' }], provideEnd: async (request) => { seen.push(request); return null; } });
    expect(seen[0].items.map((item) => [item.step, item.participant, item.text])).toEqual([['r1', 'B', 'b1']]);
  });

  test('explicit artifact with the owner edit: the last version of the line, by the User, is the item', async () => {
    const { send } = transport({ A: ['Вот:\n[[DOC: spec]]\nТЕКСТ\n[[/DOC]]'] });
    const seen = [];
    const result = await Engine.run({ task: 'T', steps: [ROUND({ output: READ }), OWNER_DOC()], send,
      provideOwnerResult: owner(['ПРАВКА USER']), end: [{ step: 'r1', participant: 'A', artifact: 'spec' }],
      provideEnd: async (request) => { seen.push(request); return null; } });
    expect(result.stopReason).toBe('steps_done');
    expect(seen[0].items).toEqual([{ step: 'r1', participant: 'A', label: 'A', title: 'ТЗ', version: 2, text: 'ПРАВКА USER' }]);
  });

  test('default items of a document round: the document (not the raw answer) with its last version', async () => {
    const { send } = transport({ A: ['Вот:\n[[DOC: spec]]\nТЕКСТ\n[[/DOC]]'] });
    const seen = [];
    await Engine.run({ task: 'T', steps: [ROUND({ output: READ })], send, provideEnd: async (request) => { seen.push(request); return null; } });
    expect(seen[0].items).toEqual([{ step: 'r1', participant: 'A', label: 'A', title: 'ТЗ', version: 1, text: 'ТЕКСТ' }]);
  });

  test('a stop mark stops the run after the step; the window gets the collected items and the reason', async () => {
    const counter = { calls: 0 };
    const { send } = transport({ A: ['СТОП: конец', 'не должен быть'] }, counter);
    const seen = [];
    const result = await Engine.run({ task: 'T', steps: [ROUND(), ROUND2()], send, stopMarks: ['СТОП:'],
      provideEnd: async (request) => { seen.push(request); return null; } });
    expect(result.stopReason).toBe('stop_mark');
    expect(counter.calls).toBe(1);
    expect(seen[0].stopReason).toBe('stop_mark');
    expect(seen[0].stopDetail).toContain('r1');
    expect(seen[0].items).toEqual([expect.objectContaining({ step: 'r1', participant: 'A', text: 'СТОП: конец' })]);
  });

  test('the window waits, is announced as an End wait, and the checkpoint keeps the pending End until it closes', async () => {
    const events = [];
    const states = [];
    const { send } = transport({ A: ['ок'] });
    const result = await Engine.run({ task: 'T', steps: [ROUND()], send, ...texts(),
      onEvent: (kind, fields) => events.push({ event: kind, ...fields }), checkpoint: (state) => { states.push(clone(state)); },
      provideEnd: async () => null });
    expect(result.stopReason).toBe('steps_done');
    const start = events.find((item) => item.event === 'custom_wait_start' && item.waitKind === 'end');
    const end = events.find((item) => item.event === 'custom_wait_end' && item.waitKind === 'end');
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    const open = states.filter((state) => state.pendingOwner?.kind === 'end');
    expect(open.length).toBeGreaterThan(0);
    expect(states[states.length - 1].pendingOwner).toBeNull();
  });

  test('resume with an open End window: no step runs, the window opens again with the same items', async () => {
    const states = [];
    const store = texts();
    const first = transport({ A: ['первый', 'второй'] });
    await Engine.run({ task: 'T', steps: [ROUND(), ROUND2()], send: first.send, putText: store.putText, getText: store.getText,
      checkpoint: (state) => { states.push(clone(state)); }, provideEnd: async () => null });
    const saved = states.find((state) => state.pendingOwner?.kind === 'end');
    expect(saved).toBeDefined();
    expect(saved.pc).toBeNull();

    const second = transport({ A: ['не должен быть'] });
    const seen = [];
    const resumed = await Engine.run({ task: 'T', steps: [ROUND(), ROUND2()], send: second.send, putText: store.putText, getText: store.getText,
      resume: clone(saved), provideEnd: async (request) => { seen.push(request); return null; } });
    expect(second.counter.calls).toBe(0);
    expect(resumed.stopReason).toBe('steps_done');
    expect(seen.length).toBe(1);
    expect(seen[0].items).toEqual([expect.objectContaining({ step: 'r2', participant: 'A', text: 'второй' })]);
  });

  test('a checkpoint failure before the window: the window does not open', async () => {
    const { send } = transport({ A: ['ок'] });
    const seen = [];
    await expect(Engine.run({ task: 'T', steps: [ROUND()], send,
      checkpoint: (state) => { if (state.pendingOwner?.kind === 'end') throw new Error('disk full'); },
      provideEnd: async (request) => { seen.push(request); return null; } })).rejects.toThrow('checkpoint_failed');
    expect(seen).toEqual([]);
  });

  test('a stop in the middle of a step: the End window keeps the resume point; closing it leaves the same snapshot pc', async () => {
    const states = [];
    const { send } = transport({ A: ['ок'], B: [] }); // B never answers: the step waits for the User, who stops it
    const result = await Engine.run({ task: 'T', steps: [ROUND({ models: ['A', 'B'] }), ROUND2()], send, ...texts(),
      decide: async () => 'stop', checkpoint: (state) => { states.push(clone(state)); }, provideEnd: async () => null });
    expect(result.stopReason).toBe('stopped');
    const windowState = states.find((state) => state.pendingOwner?.kind === 'end');
    expect(windowState).toBeDefined();
    expect(windowState.pc).toBe('r1');
    const closed = states[states.length - 1];
    expect(closed.pendingOwner).toBeNull();
    expect(closed.pc).toBe('r1');
    expect(closed).toEqual({ ...windowState, pendingOwner: null, endShown: true });
  });

  test('after a reload with the window open (stopped mid-step): no step runs, the window reopens with the same reason and items, closing keeps the pc', async () => {
    const states = [];
    const store = texts();
    const first = transport({ A: ['ок'], B: [] });
    await Engine.run({ task: 'T', steps: [ROUND({ models: ['A', 'B'] }), ROUND2()], send: first.send, putText: store.putText, getText: store.getText,
      decide: async () => 'stop', checkpoint: (state) => { states.push(clone(state)); }, provideEnd: async () => null });
    const saved = states.find((state) => state.pendingOwner?.kind === 'end');
    expect(saved.pc).toBe('r1');

    const second = transport({ A: ['не должен быть'], B: ['не должен быть'] });
    const after = [];
    const seen = [];
    const resumed = await Engine.run({ task: 'T', steps: [ROUND({ models: ['A', 'B'] }), ROUND2()], send: second.send, putText: store.putText, getText: store.getText,
      resume: clone(saved), checkpoint: (state) => { after.push(clone(state)); },
      provideEnd: async (request) => { seen.push(request); return null; } });
    expect(second.counter.calls).toBe(0);
    expect(resumed.stopReason).toBe('stopped');
    expect(seen.length).toBe(1);
    expect(seen[0].stopReason).toBe('stopped');
    expect(seen[0].items).toEqual([expect.objectContaining({ step: 'r1', participant: 'A', text: 'ок' })]);
    const closed = after[after.length - 1];
    expect(closed.pc).toBe('r1');
    expect(closed.pendingOwner).toBeNull();
    expect(closed).toEqual({ ...saved, pendingOwner: null, endShown: true });
  });

  test('a finished run whose End was not shown opens the window on resume, once', async () => {
    const states = [];
    const store = texts();
    await Engine.run({ task: 'T', steps: [ROUND()], send: transport({ A: ['ок'] }).send, ...store,
      checkpoint: (state) => { states.push(clone(state)); }, provideEnd: async () => null });
    const windowState = states.find((state) => state.pendingOwner?.kind === 'end');
    const broke = { ...windowState, pendingOwner: null }; // the run broke after its last step, before the window was shown
    expect(broke.endShown).toBe(false);

    const second = transport({ A: ['не должен быть'] });
    const after = [];
    const seen = [];
    const resumed = await Engine.run({ task: 'T', steps: [ROUND()], send: second.send, ...store, resume: clone(broke),
      checkpoint: (state) => { after.push(clone(state)); }, provideEnd: async (request) => { seen.push(request); return null; } });
    expect(second.counter.calls).toBe(0);
    expect(resumed.stopReason).toBe('steps_done');
    expect(seen.length).toBe(1);
    expect(seen[0].items).toEqual([expect.objectContaining({ step: 'r1', participant: 'A', text: 'ок' })]);
    const closed = after[after.length - 1];
    expect(closed.endShown).toBe(true);
    expect(closed.pendingOwner).toBeNull();
  });

  test('a run whose End was shown and closed does not open it again on resume', async () => {
    const states = [];
    const store = texts();
    await Engine.run({ task: 'T', steps: [ROUND()], send: transport({ A: ['ок'] }).send, ...store,
      checkpoint: (state) => { states.push(clone(state)); }, provideEnd: async () => null });
    const closed = states[states.length - 1];
    expect(closed.endShown).toBe(true);

    const seen = [];
    const resumed = await Engine.run({ task: 'T', steps: [ROUND()], send: transport({}).send, ...store, resume: clone(closed),
      provideEnd: async (request) => { seen.push(request); return null; } });
    expect(resumed.stopReason).toBe('steps_done');
    expect(seen).toEqual([]);
  });

  test('an old snapshot without the End mark and without an End is a finished run: no window', async () => {
    const states = [];
    const store = texts();
    await Engine.run({ task: 'T', steps: [ROUND()], send: transport({ A: ['ок'] }).send, ...store,
      checkpoint: (state) => { states.push(clone(state)); }, provideEnd: async () => null });
    const old = { ...states.find((state) => state.pendingOwner?.kind === 'end'), pendingOwner: null };
    delete old.endShown;

    const seen = [];
    const resumed = await Engine.run({ task: 'T', steps: [ROUND()], send: transport({}).send, ...store, resume: clone(old),
      provideEnd: async (request) => { seen.push(request); return null; } });
    expect(resumed.stopReason).toBe('steps_done');
    expect(seen).toEqual([]);
  });

  test('item label: the schema label of the participant, else the provider name, else the id', async () => {
    const { send } = transport({ GPT: ['a1'], Claude: ['b1'], C: ['c1'] });
    const seen = [];
    await Engine.run({ task: 'T',
      steps: [ROUND({ models: [{ name: 'GPT', id: 'A', label: 'Критик' }, { name: 'Claude', id: 'B' }, 'C'] })],
      send, provideEnd: async (request) => { seen.push(request); return null; } });
    expect(seen[0].items.map((item) => [item.participant, item.label])).toEqual([['A', 'Критик'], ['B', 'Claude'], ['C', 'C']]);
  });
});
