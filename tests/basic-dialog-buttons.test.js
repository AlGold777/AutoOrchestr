// Окна Basic не зависают и называют свои кнопки понятно (ревью Remote Viewfinder, B1–B4, B9).
// Проверка по исходникам: окна живут внутри большого results.js, отдельного модуля у них нет.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const results = fs.readFileSync(path.join(root, 'results.js'), 'utf8');
const panel = fs.readFileSync(path.join(root, 'pipeline_panel.html'), 'utf8');

describe('окно «Вопрос User» (B1, B9)', () => {
  test('Escape не закрывает окно без ответа', () => {
    expect(results).toMatch(/ownerAskDialog\?\.addEventListener\('cancel', \(event\) => event\.preventDefault\(\)\)/);
  });

  test('«Позже» скрывается для Basic (окно с resolve)', () => {
    expect(results).toMatch(/querySelector\('\[data-owner-ask="later"\]'\)/);
    expect(results).toMatch(/laterButton\.hidden = typeof info\.resolve === 'function'/);
  });

  test('кнопка «Позже» есть в разметке окна (для Custom-пути без resolve)', () => {
    expect(panel).toMatch(/data-owner-ask="later">Позже</);
  });
});

describe('подложка окна подтверждения (B2)', () => {
  test('клик по подложке не закрывает #confirm-modal', () => {
    expect(results).toMatch(/event\.target === modal && modal\.id !== 'confirm-modal'/);
  });
});

describe('подписи окон схемы (B3)', () => {
  test('удаление схемы: русский текст, «Удалить» / «Отмена», напоминание про экспорт', () => {
    expect(results).toMatch(/showConfirm\(`Удалить схему «\$\{activeName\}»\? Схему можно вернуть только из файла экспорта\.`, \{ confirmText: 'Удалить', cancelText: 'Отмена' \}\)/);
    expect(results).not.toMatch(/Delete pipeline "/);
  });

  test('замена схемы: «Заменить» / «Отмена» во всех четырёх местах', () => {
    const replaces = results.match(/already exists\. Replace it\?/g) || [];
    expect(replaces).toHaveLength(0);
    const russian = results.match(/showConfirm\(`Схема «\$\{[^}]+\}» уже есть\. Заменить её\?`, \{ confirmText: 'Заменить', cancelText: 'Отмена' \}\)/g) || [];
    expect(russian).toHaveLength(4);
  });

});

describe('отмена окон User и «Неизвестный запрос» (B4)', () => {
  test('provideOwnerResult: отмена называется «Остановить прогон»', () => {
    expect(results).toMatch(/choices: \[\{ value: 'send', label: 'Отправить' \}\],\s*cancelText: 'Остановить прогон',/);
  });

  test('resolveUnknown: отмена называется «Остановить прогон»', () => {
    expect(results).toMatch(/\[id\] \|\| id \}\)\),\s*cancelText: 'Остановить прогон'\s*\}\),/);
  });
});
