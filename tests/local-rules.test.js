const LocalRules = require('../disput/local-rules');
const cases = require('./fixtures/local-rules-parity.json');

const page = (overrides = {}) => ({ text: '', buttons: [], dialogs: [], ...overrides });

describe('LocalRules parity with rules2.py', () => {
  test('every fixture case gives the Python answer', () => {
    const mismatches = [];
    cases.forEach((item, index) => {
      const got = LocalRules.classify(item.page);
      if (got !== item.expect) mismatches.push({ index, src: item.src, expected: item.expect, got });
    });
    expect(mismatches).toEqual([]);
    expect(cases.length).toBe(225);
  });
});

describe('LocalRules meaning', () => {
  test('a limit window is limit_reached', () => {
    expect(LocalRules.classify(page({ dialogs: ['Достигнут лимит сообщений. Попробуйте позже.'] }))).toBe('limit_reached');
  });
  test('a login window is login_required', () => {
    expect(LocalRules.classify(page({ dialogs: ['Войдите, чтобы продолжить'] }))).toBe('login_required');
  });
  test('a Stop button means still_generating', () => {
    expect(LocalRules.classify(page({ text: 'Пишу ответ', buttons: ['Стоп'] }))).toBe('still_generating');
  });
  test('the ask line with Send after the last mark is prompt_unsent', () => {
    const text = 'Напиши только метку [[AO-ab12]]';
    expect(LocalRules.classify(page({ text, buttons: ['Отправить'] }))).toBe('prompt_unsent');
  });
  test('a mark at the end of the text is answer_ready', () => {
    expect(LocalRules.classify(page({ text: 'Готово, вот разбор документа.\n[[AO-ab12]]' }))).toBe('answer_ready');
  });
  test('a limit phrase inside the answer above the mark does not give limit_reached', () => {
    const text = 'В тексте есть фраза про лимит использования и сброс в полночь.\n[[AO-ab12]]';
    expect(LocalRules.classify(page({ text }))).toBe('answer_ready');
  });
  test('Oops after the mark is error_message', () => {
    expect(LocalRules.classify(page({ text: 'Ответ ниже.\n[[AO-ab12]]\nOops, something went wrong' }))).toBe('error_message');
  });
  test('an empty page is empty_page', () => {
    expect(LocalRules.classify(page({ text: '  ' }))).toBe('empty_page');
  });
  test('an unknown window is silent', () => {
    expect(LocalRules.classify(page({ dialogs: ['Подарок для вас: выберите цвет корпуса'] }))).toBeNull();
  });
  test('a bot as a separate word is a captcha, bot inside a longer word is not', () => {
    expect(LocalRules.classify(page({ dialogs: ['Проверка: bot-check'] }))).toBe('captcha');
    expect(LocalRules.classify(page({ dialogs: ['Abbott tools'] }))).toBeNull();
  });
});
