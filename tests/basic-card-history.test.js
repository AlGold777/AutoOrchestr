const Record = require('../disput/custom-run-record');
require('../results/basic-card-history.js');

const History = window.BasicCardHistory;

function makeCard({ text = '', title = 'Model', kind = 'answer', runId = '', sessionId = '', status = 'SUCCESS' } = {}) {
  const card = document.createElement('article');
  card.className = 'debate-model-card';
  card.dataset.kind = kind;
  card.dataset.status = status;
  if (runId) card.dataset.pipelineRunId = runId;
  if (sessionId) card.dataset.sessionId = sessionId;
  const header = document.createElement('header');
  header.className = 'debate-model-card-header';
  header.textContent = title;
  const output = document.createElement('div');
  output.className = 'debate-model-card-output';
  output.textContent = text;
  card.append(header, output);
  return card;
}

function setup(runId = 'history-run') {
  const container = document.createElement('div');
  container.id = 'debate-model-cards';
  document.body.append(container);
  const record = Record.createRun({ runId, task: 'task' });
  const changes = jest.fn();
  const collector = History.create({ container, record, onChange: changes, sessionId: 'session-1' });
  return { container, record, collector, changes };
}

describe('Basic card history', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('captures new answer, Basic, and User cards and ignores unchanged snapshots', () => {
    const { container, record, collector, changes } = setup();
    const cards = [
      makeCard({ text: 'answer text', title: 'Model A', kind: 'answer' }),
      makeCard({ text: 'basic text', title: 'Basic', kind: 'basic' }),
      makeCard({ text: 'user text', title: 'User', kind: 'user' })
    ];
    cards.forEach((card) => container.append(card));
    collector.flush();

    expect(record.cardHistory).toMatchObject({ version: 1, coverage: 'dom_observer_batches' });
    expect(record.cardHistory.events.map(({ type }) => type)).toEqual(['created', 'created', 'created']);
    expect(record.cardHistory.events.map(({ snapshot }) => Record.textOf(record, snapshot.textRef)))
      .toEqual(['answer text', 'basic text', 'user text']);
    expect(record.cardHistory.events.map(({ snapshot }) => snapshot.kind)).toEqual(['answer', 'basic', 'user']);
    const count = record.cardHistory.events.length;
    collector.flush();
    expect(record.cardHistory.events).toHaveLength(count);
    expect(changes).toHaveBeenCalledTimes(1);
  });

  test('records output and status updates, then removes a card removed from a nested task', () => {
    const { container, record, collector } = setup();
    const task = document.createElement('section');
    task.className = 'task';
    container.append(task);
    const card = makeCard({ text: 'first', status: 'PENDING' });
    task.append(card);
    collector.flush();
    card.querySelector('.debate-model-card-output').textContent = 'second';
    card.dataset.status = 'SUCCESS';
    collector.flush();
    task.removeChild(card);
    collector.flush();

    const events = record.cardHistory.events;
    expect(events.map(({ type }) => type)).toEqual(['created', 'updated', 'removed']);
    expect(Record.textOf(record, events[0].snapshot.textRef)).toBe('first');
    expect(events[1].snapshot.status).toBe('SUCCESS');
    expect(Record.textOf(record, events[1].snapshot.textRef)).toBe('second');
    expect(events[2].cardId).toBe(events[0].cardId);
  });

  test('treats a move inside the feed as the same card, not a removal', () => {
    const { container, record, collector } = setup();
    const left = document.createElement('section');
    const right = document.createElement('section');
    container.append(left, right);
    const card = makeCard({ text: 'kept' });
    left.append(card);
    collector.flush();
    right.append(card);
    collector.flush();

    expect(record.cardHistory.events.map(({ type }) => type)).toEqual(['created']);
    expect(record.cardHistory.events[0].cardId).toBe('history-run:card:1');
  });

  test('excludes pre-existing cards without run identity and cards explicitly owned by another run', () => {
    const container = document.createElement('div');
    const old = makeCard({ text: 'old' });
    const foreign = makeCard({ text: 'foreign', runId: 'another-run' });
    const own = makeCard({ text: 'already mine', runId: 'history-run' });
    container.append(old, foreign, own);
    document.body.append(container);
    const record = Record.createRun({ runId: 'history-run' });
    const collector = History.create({ container, record });
    const current = makeCard({ text: 'current' });
    container.append(current);
    collector.flush();

    expect(record.cardHistory.events.map(({ type }) => type)).toEqual(['observed', 'created']);
    expect(record.cardHistory.events.map(({ snapshot }) => Record.textOf(record, snapshot.textRef)))
      .toEqual(['already mine', 'current']);
  });

  test('continues event and card sequences after revive', () => {
    const first = Record.createRun({ runId: 'history-run' });
    first.cardHistory = { version: 1, coverage: 'dom_observer_batches', events: [
      { seq: 8, type: 'created', cardId: 'history-run:card:4', snapshot: { textRef: first.put('prior') } }
    ] };
    const record = Record.revive(JSON.parse(JSON.stringify(Record.serialize(first))));
    const { container, collector } = (() => {
      const container = document.createElement('div');
      document.body.append(container);
      return { container, collector: History.create({ container, record }) };
    })();
    container.append(makeCard({ text: 'after reload' }));
    collector.flush();

    expect(record.cardHistory.events.at(-1)).toMatchObject({ seq: 9, type: 'created', cardId: 'history-run:card:5' });
  });

  test('flushes pending observer records on disconnect', () => {
    const { container, record, collector } = setup();
    container.append(makeCard({ text: 'pending' }));
    collector.disconnect();

    expect(record.cardHistory.events).toHaveLength(1);
    expect(Record.textOf(record, record.cardHistory.events[0].snapshot.textRef)).toBe('pending');
  });

  test('ignores unknown cards after the session becomes inactive but keeps explicitly owned late updates', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const record = Record.createRun({ runId: 'history-run' });
    let active = true;
    const collector = History.create({ container, record, sessionId: 'session-1', isActive: () => active });
    active = false;
    container.append(makeCard({ text: 'unknown', sessionId: 'session-1' }));
    collector.flush();
    expect(record.cardHistory.events).toHaveLength(0);

    const ownLate = makeCard({ text: 'late own', runId: 'history-run', sessionId: 'session-1' });
    container.append(ownLate);
    collector.flush();
    ownLate.querySelector('.debate-model-card-output').textContent = 'late own updated';
    collector.flush();
    expect(record.cardHistory.events.map(({ type }) => type)).toEqual(['created', 'updated']);
    expect(Record.textOf(record, record.cardHistory.events[1].snapshot.textRef)).toBe('late own updated');
  });

  test('excludes cards from a different session even when their run id matches', () => {
    const { container, record, collector } = setup();
    container.append(makeCard({ text: 'foreign session', runId: 'history-run', sessionId: 'session-2' }));
    collector.flush();
    expect(record.cardHistory.events).toHaveLength(0);
  });

  test('reuses card identity and snapshot across reconnects to the same container and run', () => {
    const { container, record, collector } = setup();
    const card = makeCard({ text: 'before reconnect' });
    container.append(card);
    collector.flush();
    const id = record.cardHistory.events[0].cardId;
    collector.disconnect();

    const reconnected = History.create({ container, record, sessionId: 'session-1' });
    expect(record.cardHistory.events).toHaveLength(1);
    card.querySelector('.debate-model-card-output').textContent = 'after reconnect';
    reconnected.flush();
    expect(record.cardHistory.events.map(({ type }) => type)).toEqual(['created', 'updated']);
    expect(record.cardHistory.events[1].cardId).toBe(id);
  });

  test('reconnects from an older checkpoint without dangling patch references', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const original = Record.createRun({ runId: 'history-run' });
    const card = makeCard({ text: 'A'.repeat(700), runId: 'history-run' });
    container.append(card);
    const collector = History.create({ container, record: original, sessionId: 'session-1' });
    const checkpoint = JSON.parse(JSON.stringify(Record.serialize(original)));
    card.querySelector('.debate-model-card-output').textContent = `${'A'.repeat(650)}${'B'.repeat(80)}`;
    collector.flush();
    expect(original.cardHistory.events[1].snapshot.textPatch).toBeDefined();
    collector.disconnect();

    const revived = Record.revive(checkpoint);
    card.querySelector('.debate-model-card-output').textContent = 'A'.repeat(700);
    const reconnected = History.create({ container, record: revived, sessionId: 'session-1' });
    card.querySelector('.debate-model-card-output').textContent = `${'A'.repeat(650)}${'C'.repeat(80)}`;
    reconnected.flush();

    expect(revived.cardHistory.events.map(({ type }) => type)).toEqual(['observed', 'updated']);
    const seqs = new Set(revived.cardHistory.events.map(({ seq }) => seq));
    for (const event of revived.cardHistory.events) {
      const { textRef, textPatch } = event.snapshot;
      if (textRef) expect(Record.textOf(revived, textRef)).toBeTruthy();
      if (textPatch) {
        expect(seqs.has(textPatch.baseSeq)).toBe(true);
        if (textPatch.suffixRef) expect(Record.textOf(revived, textPatch.suffixRef)).toBeTruthy();
      }
    }
    expect(revived.cardHistory.events[1].snapshot.textPatch.baseSeq).toBe(revived.cardHistory.events[0].seq);
  });

  test('stores long text changes as reconstructable prefix patches and reuses them for status-only updates', () => {
    const { container, record, collector } = setup();
    const first = 'A'.repeat(700);
    const second = `${'A'.repeat(650)}${'B'.repeat(80)}`;
    const third = `${'A'.repeat(650)}${'C'.repeat(80)}`;
    const card = makeCard({ text: first });
    container.append(card);
    collector.flush();
    card.querySelector('.debate-model-card-output').textContent = second;
    collector.flush();
    card.dataset.status = 'SUCCESS_REVISED';
    collector.flush();
    card.querySelector('.debate-model-card-output').textContent = third;
    collector.flush();

    const events = record.cardHistory.events;
    expect(events[0].snapshot.textRef).toBeTruthy();
    expect(events[0].snapshot.textLength).toBe(first.length);
    expect(events[1].snapshot).toMatchObject({ textLength: second.length, textRef: null,
      textPatch: { baseSeq: events[0].seq, prefixLength: 650 } });
    expect(events[2].snapshot.textPatch).toEqual(events[1].snapshot.textPatch);
    expect(events[3].snapshot.textPatch).toMatchObject({ baseSeq: events[2].seq, prefixLength: 650 });

    const reconstruct = (event) => event.snapshot.textRef
      ? Record.textOf(record, event.snapshot.textRef)
      : reconstruct(events.find(({ seq }) => seq === event.snapshot.textPatch.baseSeq))
        .slice(0, event.snapshot.textPatch.prefixLength)
        + Record.textOf(record, event.snapshot.textPatch.suffixRef);
    expect(events.map(reconstruct)).toEqual([first, second, second, third]);
  });

  test('a huge post-terminal revision is stored as head and tail, with the cut length marked', () => {
    const { container, record, collector } = setup();
    const card = makeCard({ text: 'answer', title: 'GPT', kind: 'answer' });
    const revision = document.createElement('div');
    revision.className = 'post-terminal-answer-revision';
    revision.textContent = `HEAD-${'x'.repeat(250000)}-TAIL`;
    card.append(revision);
    container.append(card);
    collector.flush();
    const snapshot = record.cardHistory.events[0].snapshot;
    const stored = Record.textOf(record, snapshot.revisionTextRef);
    expect(stored.length).toBeLessThan(13000);
    expect(stored.startsWith('HEAD-')).toBe(true);
    expect(stored.endsWith('-TAIL')).toBe(true);
    expect(stored).toContain('усечено');
    expect(snapshot.revisionTextLength).toBe(250000 + 'HEAD--TAIL'.length);
  });

  test('a short revision is stored as it is', () => {
    const { container, record, collector } = setup();
    const card = makeCard({ text: 'answer', title: 'GPT', kind: 'answer' });
    const revision = document.createElement('div');
    revision.className = 'post-terminal-answer-revision';
    revision.textContent = 'short revision';
    card.append(revision);
    container.append(card);
    collector.flush();
    expect(Record.textOf(record, record.cardHistory.events[0].snapshot.revisionTextRef)).toBe('short revision');
  });
});
