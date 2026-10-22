// Control markers and owner-ask dialog helpers.
const fs = require('fs');
const path = require('path');
const Markers = require('../disput/stage-markers');
const OwnerAsk = require('../results/owner-ask');

const source = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('stage markers', () => {
  test('ASK and VERDICT are read from lines of their own, with light decoration', () => {
    const text = [
      'Анализ.', '', '- [[ASK: Какой бюджет?]]', '**[[ASK: Кто владелец данных?]]**',
      '[[verdict: ISSUES_FOUND]]', '[[AO-abc123]]'
    ].join('\n');
    expect(Markers.parse(text)).toEqual({
      verdict: 'issues_found', asks: ['Какой бюджет?', 'Кто владелец данных?'],
      askItems: [{ question: 'Какой бюджет?', options: [], multi: false }, { question: 'Кто владелец данных?', options: [], multi: false }], invalid: []
    });
  });

  test('markers inside code fences, quotes or running text are data, not control', () => {
    const text = [
      'Правило: пиши [[ASK: вопрос]] отдельной строкой.',
      '> [[ASK: цитата]]', '```', '[[VERDICT: pass]]', '[[ASK: в коде]]', '```'
    ].join('\n');
    expect(Markers.parse(text)).toEqual({ verdict: null, asks: [], askItems: [], invalid: [] });
  });

  test('duplicates collapse, at most 3 questions, empty questions are ignored, bad verdicts are reported', () => {
    const text = ['[[ASK: Q1]]', '[[ask: q1]]', '[[ASK: ]]', '[[ASK: Q2]]', '[[ASK: Q3]]', '[[ASK: Q4]]', '[[VERDICT: maybe]]'].join('\n');
    const parsed = Markers.parse(text);
    expect(parsed.asks).toEqual(['Q1', 'Q2', 'Q3']);
    expect(parsed.verdict).toBeNull();
    expect(parsed.invalid).toEqual([{ kind: 'VERDICT', value: 'maybe' }]);
    expect(Markers.parse('[[VERDICT: pass]]\n[[VERDICT: issues_found]]').verdict).toBe('issues_found'); // the last valid one
    expect(Markers.parse(null)).toEqual({ verdict: null, asks: [], askItems: [], invalid: [] });
  });

  test('ASK options: 2-5 choices after ||, the last word "несколько" allows several, one option is not a choice', () => {
    const parsed = Markers.parse([
      '[[ASK: За какой период? || 2024–2026 || Без ограничения || несколько]]',
      '[[ASK: Кто? || один]]',
      '[[ASK: Формат? || A || a || B || C || D || E || F]]'
    ].join('\n'));
    expect(parsed.askItems).toEqual([
      { question: 'За какой период?', options: ['2024–2026', 'Без ограничения'], multi: true },
      { question: 'Кто?', options: [], multi: false },
      { question: 'Формат?', options: ['A', 'B', 'C', 'D', 'E'], multi: false }
    ]);
    expect(parsed.asks).toEqual(['За какой период?', 'Кто?', 'Формат?']);
  });

  test('instructions: ASK for every stage, VERDICT only for review stages', () => {
    expect(Markers.instructions({ purpose: 'position' })).toContain('[[ASK: вопрос || вариант 1 || вариант 2]]');
    expect(Markers.instructions({ purpose: 'position' })).not.toContain('VERDICT');
    ['critique', 'verification', 'evidence_review'].forEach((purpose) => expect(Markers.instructions({ purpose })).toContain('[[VERDICT: pass]]'));
  });

  test('combining several participants: any issues_found wins', () => {
    expect(Markers.combineVerdicts(['pass', 'issues_found', null])).toBe('issues_found');
    expect(Markers.combineVerdicts(['pass', null])).toBe('pass');
    expect(Markers.combineVerdicts([null])).toBeNull();
  });
});

describe('owner ask dialog helpers', () => {
  const asks = [{ participantId: 'GPT', question: 'Какой бюджет?' }, { participantId: 'Claude', question: 'Кто владелец?' }];

  test('render writes text only; collect keeps answered questions; instruction names question and answer', () => {
    const container = document.createElement('div');
    OwnerAsk.render(container, [{ participantId: 'GPT', question: '<img src=x onerror=1>?', options: ['<b>да</b>', 'нет'] }]);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    container.replaceChildren();
    OwnerAsk.render(container, asks);
    // Questions without options offer one standard choice and a comment, no required typing.
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(2);
    container.querySelector('input[data-ask-index="1"]').checked = true;
    const answers = OwnerAsk.collect(container, asks);
    expect(answers).toEqual([{ question: 'Кто владелец?', answer: OwnerAsk.DELEGATE_LABEL, selected: [OwnerAsk.DELEGATE_LABEL], comment: '', participantId: 'Claude' }]);
    expect(OwnerAsk.toInstruction(answers)).toBe(`Ответ владельца на вопрос «Кто владелец?»: ${OwnerAsk.DELEGATE_LABEL}`);
  });

  test('options: radio for one choice, checkboxes for several, optional comment; nothing picked means not answered', () => {
    const optionAsks = [
      { participantId: 'GPT', question: 'Период?', options: ['2024', '2025', 'Все'] },
      { participantId: 'Claude', question: 'Регионы?', options: ['ЕС', 'США', 'Азия'], multi: true }
    ];
    const container = document.createElement('div');
    OwnerAsk.render(container, optionAsks);
    expect(container.querySelectorAll('input[type=radio]')).toHaveLength(3);
    expect(container.querySelectorAll('input[type=checkbox]')).toHaveLength(3);
    expect(container.querySelectorAll('textarea')).toHaveLength(2);
    expect(OwnerAsk.collect(container, optionAsks)).toEqual([]);
    container.querySelector('input[data-ask-index="0"][data-choice-index="1"]').checked = true;
    container.querySelector('input[data-ask-index="1"][data-choice-index="0"]').checked = true;
    container.querySelector('input[data-ask-index="1"][data-choice-index="2"]').checked = true;
    container.querySelector('textarea[data-ask-comment="1"]').value = '  особенно ЕС ';
    const answers = OwnerAsk.collect(container, optionAsks);
    expect(answers).toEqual([
      { question: 'Период?', answer: '2025', selected: ['2025'], comment: '', participantId: 'GPT' },
      { question: 'Регионы?', answer: 'ЕС; Азия. Комментарий: особенно ЕС', selected: ['ЕС', 'Азия'], comment: 'особенно ЕС', participantId: 'Claude' }
    ]);
    expect(OwnerAsk.toInstruction(answers)).toBe('Ответ владельца на вопрос «Период?»: 2025\nОтвет владельца на вопрос «Регионы?»: ЕС; Азия. Комментарий: особенно ЕС');
  });

  test('a comment alone counts as an answer', () => {
    const one = [{ question: 'Период?', options: ['2024', '2025'] }];
    const container = document.createElement('div');
    OwnerAsk.render(container, one);
    container.querySelector('textarea').value = 'пока не знаю';
    expect(OwnerAsk.collect(container, one)).toEqual([{ question: 'Период?', answer: 'Комментарий: пока не знаю', selected: [], comment: 'пока не знаю', participantId: '' }]);
  });

});
