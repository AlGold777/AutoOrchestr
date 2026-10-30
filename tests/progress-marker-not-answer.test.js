/** @jest-environment node */
// L-2: a delivery marker after a progress line («Проверю…») is not the end of the answer.
// A marker after a short content answer («Замечаний нет.») still is.
const Delivery = require('../shared/message-delivery.js');
const Acceptance = require('../disput/debate-response-acceptance.js');

const tokenFor = (prompts, model) => /\[\[AO-[a-z0-9]{6}\]\]/.exec(prompts[model])[0];

describe('progress line followed by the delivery marker', () => {
  beforeEach(() => Delivery.reset());

  test('a progress line with the marker is PARTIAL with reason progress_only, not SUCCESS', () => {
    const prompts = Delivery.prepare({ prompt: 'Проверь план', models: ['GPT'] });
    const token = tokenFor(prompts, 'GPT');
    const msg = Delivery.receive({ llmName: 'GPT', answer: `Проверю план и риски.\n\n${token}` }, { final: false });
    expect(msg.metadata.answerEndMarkerSeen).toBe(false);
    expect(msg.metadata.status).toBe('PARTIAL');
    expect(msg.metadata.reason).toBe('progress_only');
    expect(msg.metadata.terminal).toBeUndefined();
  });

  test('a later content answer with the same request still counts the marker', () => {
    const prompts = Delivery.prepare({ prompt: 'Проверь план', models: ['GPT'] });
    const token = tokenFor(prompts, 'GPT');
    Delivery.receive({ llmName: 'GPT', answer: `Проверю план.\n${token}` }, { final: false });
    const done = Delivery.receive({ llmName: 'GPT', answer: `Замечаний нет.\n\n${token}` }, { final: true });
    expect(done.answer).toBe('Замечаний нет.');
    expect(done.metadata.answerEndMarkerSeen).toBe(true);
    expect(done.metadata.status).toBe('SUCCESS');
  });

  test('a short content answer with the marker is accepted as SUCCESS', () => {
    const prompts = Delivery.prepare({ prompt: 'Есть замечания?', models: ['GPT'] });
    const token = tokenFor(prompts, 'GPT');
    const msg = Delivery.receive({ llmName: 'GPT', answer: `Замечаний нет.\n${token}` }, { final: true });
    expect(msg.metadata.answerEndMarkerSeen).toBe(true);
    expect(msg.metadata.status).toBe('SUCCESS');
    expect(msg.metadata.reason).toBeUndefined();
  });

  test('a long text that starts like progress is not progress-only', () => {
    const prompts = Delivery.prepare({ prompt: 'Разбор', models: ['GPT'] });
    const token = tokenFor(prompts, 'GPT');
    const body = `Проверил план подробно. ${'Раздел разбирает риски, сроки и зависимости между этапами. '.repeat(6)}`;
    const msg = Delivery.receive({ llmName: 'GPT', answer: `${body}\n${token}` }, { final: true });
    expect(msg.metadata.answerEndMarkerSeen).toBe(true);
    expect(msg.metadata.status).toBe('SUCCESS');
  });

  test('isProgressOnlyBody separates progress lines from content', () => {
    expect(Delivery.isProgressOnlyBody('Проверю…')).toBe(true);
    expect(Delivery.isProgressOnlyBody('Проверил, замечаний нет.')).toBe(false);
    expect(Delivery.isProgressOnlyBody('Замечаний нет.')).toBe(false);
    expect(Delivery.isProgressOnlyBody('')).toBe(false);
  });
});

describe('acceptance refuses a progress-only delivery', () => {
  test('reason progress_only from the delivery layer is refused', () => {
    expect(Acceptance.evaluate({ text: 'Проверю план и риски.', meta: { status: 'PARTIAL', reason: 'progress_only' } }))
      .toEqual(expect.objectContaining({ ok: false, reason: 'progress_only' }));
  });

  test('a content answer with the same kind of marker is accepted', () => {
    expect(Acceptance.evaluate({ text: 'Замечаний нет.', meta: { status: 'SUCCESS', completion: 'complete' } }).ok).toBe(true);
  });
});
