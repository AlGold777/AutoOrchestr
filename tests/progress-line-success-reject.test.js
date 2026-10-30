const Classifier = require('../shared/answer-content-classifier');
const A = require('../disput/debate-response-acceptance');
const Engine = require('../disput/custom-engine');
const { CLASSES } = Classifier;

const prompt = 'Проверь архитектуру и выпиши замечания по каждому разделу документа.';
const longAnswer = 'Архитектура выдерживает нагрузку, но очередь сообщений нужно вынести в отдельный сервис. '
  + 'Без этого при пике задержка растёт, и подтверждения доставки теряются при перезапуске.';

describe('progress lines of a model without a delivery token are UI noise, not answers', () => {
  test.each([
    'Проверил измерения задержки Анализируя сетевые ограничения',
    'Проверил и уточнил технические риски',
    'Анализирую условия поставленной задачи',
    'Уточнил план ответа и проверил технические риски',
    'Сверяю цифры с источниками',
    'Изучаю требования к задержке',
    'Проверяю расчёты по второму пункту',
    'Думаю над структурой ответа',
    'Проектирую архитектуру модуля…',
    'Thinking about the risks',
    'Analyzing the latency requirements',
    'Checked the constraints and refined the plan'
  ])('%s', (text) => {
    const r = Classifier.classify(text, { prompt });
    expect(r.contentClass).toBe(CLASSES.UI_NOISE);
    expect(r.terminalEligible).toBe(false);
    expect(Classifier.isProgressLine(text)).toBe(true);
  });

  test('a progress line is noise up to 300 characters; a long text without a token is not a progress line', () => {
    const glued = 'Проверил риски Уточнил план Анализируя задержку и сетевые ограничения, сверяю источники и цифры по каждому пункту, '
      + 'затем собираю итог и формулирую вывод для второго раунда обсуждения.';
    expect(glued.length).toBeLessThan(300);
    expect(Classifier.classify(glued, { prompt }).contentClass).toBe(CLASSES.UI_NOISE);
    const long = `Проверил архитектуру. ${'Очередь нужно вынести в отдельный сервис и проверить восстановление после сбоя. '.repeat(4)}`;
    expect(long.length).toBeGreaterThan(300);
    expect(Classifier.classify(long, { prompt }).terminalEligible).toBe(true);
  });

  test('the same progress line with the delivery token is kept as the answer it marks', () => {
    expect(Classifier.classify('Проверил и уточнил технические риски [[AO-abc234]]', { prompt }).terminalEligible).toBe(true);
  });
});

describe('a short verdict of the reviewer is an answer', () => {
  test.each([
    'Замечаний нет.',
    'Согласен, без правок.',
    'Проверил, замечаний нет.',
    'Согласна.',
    'Looks good to me.'
  ])('%s is not a progress line and is terminal-eligible', (text) => {
    expect(Classifier.isProgressLine(text)).toBe(false);
    expect(Classifier.isMeaningfulShort(text)).toBe(true);
    expect(Classifier.classify(text, { prompt }).terminalEligible).toBe(true);
  });
});

describe('acceptance refuses a short SUCCESS text that is not a finished answer', () => {
  test('a progress line marked complete by the transport is refused as too_short, with a readable reason', () => {
    const verdict = A.evaluate({ text: 'Проверил и уточнил технические риски', meta: { status: 'SUCCESS', completion: 'complete', prompt } });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe('too_short');
    expect(verdict.details.progressLine).toBe(true);
    expect(Engine.REASON_TEXT.too_short).toMatch(/без признаков конца ответа/);
  });

  test('a short text with no sign of an ending and no proof of its end is refused, even without a progress verb', () => {
    expect(A.evaluate({ text: 'Проверяя архитектуру', meta: { status: 'SUCCESS' } }).reason).toBe('too_short');
    expect(A.evaluate({ text: 'Готово', meta: { status: 'SUCCESS' } }).reason).toBe('too_short');
  });

  test('a short verdict proven complete is accepted', () => {
    expect(A.evaluate({ text: 'Замечаний нет.', meta: { status: 'SUCCESS', completion: 'complete' } }).ok).toBe(true);
    expect(A.evaluate({ text: 'Согласен, без правок.', meta: { status: 'SUCCESS' } }).ok).toBe(true);
    expect(A.evaluate({ text: 'Да.', meta: { completion: 'complete', status: 'SUCCESS' } }).ok).toBe(true);
  });

  test('a full answer of the same status is accepted; direct_answer tasks keep short answers', () => {
    expect(A.evaluate({ text: longAnswer, meta: { status: 'SUCCESS', completion: 'complete' } }).ok).toBe(true);
    expect(A.evaluate({ text: 'Готово', meta: { status: 'SUCCESS', taskClass: 'direct_answer' } }).ok).toBe(true);
  });
});
