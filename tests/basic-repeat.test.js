const BasicRepeat = require('../disput/basic-repeat');
const BasicOutput = require('../disput/basic-output');

const MARKER = '=== КАРТА ВОПРОСА ===';
const repeat = (extra = {}) => ({ carry: { step: 'r14', participant: 'map', artifact: 'map' }, carryMarker: MARKER, maxPasses: 10, ...extra });

describe('basic-repeat: splitTask', () => {
  test('the marker in the middle: the template ends with its line, the carried text is what follows', () => {
    const task = `Задача\n${MARKER}\nC1\nC2`;
    expect(BasicRepeat.splitTask(task, MARKER)).toEqual({ template: `Задача\n${MARKER}\n`, carried: 'C1\nC2' });
  });

  test('a marker line with spaces around it is found', () => {
    expect(BasicRepeat.splitTask(`A\n   ${MARKER}  \nX`, MARKER)).toEqual({ template: `A\n   ${MARKER}  \n`, carried: 'X' });
  });

  test('no marker line gives null', () => {
    expect(BasicRepeat.splitTask(`A\nтекст ${MARKER}\nB`, MARKER)).toBeNull();
  });

  test('a marker as the last line leaves the carried text empty', () => {
    expect(BasicRepeat.splitTask(`A\n${MARKER}`, MARKER)).toEqual({ template: `A\n${MARKER}`, carried: '' });
  });
});

describe('basic-repeat: fillCounters and taskForPass', () => {
  test('{заход}, {заход+N} and {осталось запросов} take their values', () => {
    const text = 'Заход {заход} из 10, следующий {заход+11}, осталось {осталось запросов}.';
    expect(BasicRepeat.fillCounters(text, { pass: 2, requestsLeft: 180 })).toBe('Заход 2 из 10, следующий 13, осталось 180.');
    expect(BasicRepeat.fillCounters(text, { pass: 2, requestsLeft: null })).toBe('Заход 2 из 10, следующий 13, осталось без предела.');
  });

  test('text without counters does not change', () => {
    expect(BasicRepeat.fillCounters('Просто текст {другое}', { pass: 1, requestsLeft: 5 })).toBe('Просто текст {другое}');
  });

  test('taskForPass of a split task restores the task without the marker-free parts, the counters filled', () => {
    const task = `Заход {заход}, запросов {осталось запросов}\n${MARKER}\nДОКУМЕНТ`;
    const parts = BasicRepeat.splitTask(task, MARKER);
    expect(BasicRepeat.taskForPass({ ...parts, pass: 1, requestsLeft: 90 })).toBe(`Заход 1, запросов 90\n${MARKER}\nДОКУМЕНТ`);
    const plain = `Задача без счётчиков\n${MARKER}\nД`;
    expect(BasicRepeat.taskForPass({ ...BasicRepeat.splitTask(plain, MARKER), pass: 1, requestsLeft: null })).toBe(plain);
  });
});

describe('basic-repeat: carriedText', () => {
  const extractDocument = BasicOutput.extractDocument;
  const cleanAnswer = BasicOutput.cleanAnswer;
  const entry = (text, extra = {}) => ({ id: 'x', lineage: { step: 'r14', participant: 'map', id: 'map' }, valid: true, text, ...extra });
  const carry = { step: 'r14', participant: 'map', artifact: 'map' };

  test('the document between the marks of the answer', () => {
    const artifacts = [entry('Вступление\n[[DOC: map]]Карта вопроса[[/DOC]]\nКонец')];
    expect(BasicRepeat.carriedText({ artifacts, carry, extractDocument, cleanAnswer })).toBe('Карта вопроса');
  });

  test('an answer without marks gives its clean text', () => {
    const artifacts = [entry('  Ответ целиком  ')];
    expect(BasicRepeat.carriedText({ artifacts, carry, extractDocument, cleanAnswer })).toBe('Ответ целиком');
  });

  test('of two versions the last one counts; a last invalid one is skipped for the earlier valid one', () => {
    const two = [entry('[[DOC: map]]первая[[/DOC]]'), entry('[[DOC: map]]вторая[[/DOC]]')];
    expect(BasicRepeat.carriedText({ artifacts: two, carry, extractDocument, cleanAnswer })).toBe('вторая');
    const lastInvalid = [entry('[[DOC: map]]годная[[/DOC]]'), entry('[[DOC: map]]битая[[/DOC]]', { valid: false })];
    expect(BasicRepeat.carriedText({ artifacts: lastInvalid, carry, extractDocument, cleanAnswer })).toBe('годная');
  });

  test('no matching record, or an empty text, gives null', () => {
    expect(BasicRepeat.carriedText({ artifacts: [], carry, extractDocument, cleanAnswer })).toBeNull();
    const other = [{ id: 'x', lineage: { step: 'r2', participant: 'map', id: 'map' }, valid: true, text: 'ответ' }];
    expect(BasicRepeat.carriedText({ artifacts: other, carry, extractDocument, cleanAnswer })).toBeNull();
    expect(BasicRepeat.carriedText({ artifacts: [entry('   ')], carry, extractDocument, cleanAnswer })).toBeNull();
  });
});

describe('basic-repeat: decide', () => {
  const ok = { repeat: repeat(), pass: 1, requestsUsed: 10, stopReason: 'steps_done', carried: 'Документ', saved: true };
  const decideWith = (patch) => BasicRepeat.decide({ ...ok, ...patch });

  test('a pass that finished, saved and has a document goes on', () => {
    expect(decideWith({})).toEqual({ go: true, reason: '', ownerWindow: false });
  });

  test('each stop reason gives go false and its own reason', () => {
    expect(decideWith({ stopReason: 'stop_mark' })).toEqual({ go: false, reason: 'not_done', ownerWindow: false });
    expect(decideWith({ saved: false })).toEqual({ go: false, reason: 'not_saved', ownerWindow: false });
    expect(decideWith({ carried: null })).toEqual({ go: false, reason: 'no_carry', ownerWindow: false });
    expect(decideWith({ repeat: repeat({ carryMaxChars: 5 }) })).toEqual({ go: false, reason: 'carry_too_long', ownerWindow: false });
    expect(decideWith({ pass: 10 })).toEqual({ go: false, reason: 'passes', ownerWindow: false });
    expect(decideWith({ repeat: repeat({ maxRequests: 10 }) })).toEqual({ go: false, reason: 'requests', ownerWindow: false });
  });

  test('the first condition that holds gives the reason', () => {
    expect(decideWith({ stopReason: 'no_answer', saved: false, carried: null, pass: 10 }).reason).toBe('not_done');
    expect(decideWith({ saved: false, carried: null, pass: 10 }).reason).toBe('not_saved');
    expect(decideWith({ carried: null, pass: 10 }).reason).toBe('no_carry');
    expect(decideWith({ repeat: repeat({ carryMaxChars: 5, maxRequests: 10 }), pass: 10 }).reason).toBe('carry_too_long');
    expect(decideWith({ repeat: repeat({ maxRequests: 10 }), pass: 10 }).reason).toBe('passes');
  });

  test('the owner window opens on the passes divisible by ownerEvery', () => {
    const at = (pass) => BasicRepeat.decide({ ...ok, pass, repeat: repeat({ ownerEvery: 5, maxPasses: 50 }) });
    expect(at(4).ownerWindow).toBe(false);
    expect(at(5).ownerWindow).toBe(true);
    expect(at(10).ownerWindow).toBe(true);
    expect(BasicRepeat.decide({ ...ok, pass: 5, repeat: repeat({ maxPasses: 5, ownerEvery: 5 }) })).toEqual({ go: false, reason: 'passes', ownerWindow: false });
  });

  test('REASON_TEXT gives the text of every reason', () => {
    expect(BasicRepeat.REASON_TEXT).toEqual({
      not_done: 'заход не дошёл до конца',
      not_saved: 'запись захода не сохранена',
      no_carry: 'нет документа для переноса',
      carry_too_long: 'документ для переноса длиннее предела',
      passes: 'достигнут предел заходов',
      requests: 'достигнут предел запросов'
    });
  });
});
