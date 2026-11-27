const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkRun, ideaProblems, cutProblem } = require('../scripts/agent/check-run.js');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'agent', 'check-run.js');
const long = (tag) => `${tag}: ${Array.from({ length: 200 }, (_, at) => `слово${at}`).join(' ')}.`;

const attempt = (participant, answer, extra = {}) => ({
  ref: 'r1', visit: 1, phase: 'answer', participant, model: participant.toUpperCase(),
  state: 'done', accepted: true, status: 'SUCCESS', answerRef: null, answer, ...extra
});

const exportOf = (attempts, { rounds = [], texts = {}, output } = {}) => ({
  format: 'basic-telemetry/3',
  extensionVersion: 'test',
  customRun: {
    pipelineName: 'Тест', stopReason: 'steps_done', texts, attempts,
    snapshot: { steps: [{ ref: 'r1', output, models: [] }], runSettings: {} }
  },
  rounds
});

const flagsOf = (rows, participant) => rows.find((row) => row.participant === participant).flags.join('; ');

describe('check-run: проверка ответов прогона', () => {
  test('обычные ответы не отмечаются', () => {
    const rows = checkRun(exportOf([attempt('a', long('A')), attempt('b', long('B')), attempt('c', long('C'))]));
    expect(rows.flatMap((row) => row.flags)).toEqual([]);
  });

  test('отсутствие метки конца само по себе не повод читать ответ', () => {
    const tail = { sentPromptTailRef: 't1' };
    const texts = { t1: 'Последней строкой ответа напиши только метку [[AO-abc123]]' };
    const rows = checkRun(exportOf([attempt('a', long('A'), tail)], { texts }));
    expect(rows[0].flags).toEqual([]);
    expect(rows[0].notes).toEqual([]);
  });

  test('обрывок среди полных ответов: короткий и оборванный', () => {
    const rows = checkRun(exportOf([attempt('a', long('A')), attempt('b', long('B')),
      attempt('c', 'Тон кожи (по шкале Фицпатрика),')]));
    expect(flagsOf(rows, 'c')).toMatch(/намного короче других/);
    expect(flagsOf(rows, 'c')).toMatch(/кончается на «,»/);
    expect(flagsOf(rows, 'a')).toBe('');
  });

  test('лимит, повтор запроса, одинаковые ответы', () => {
    const rows = checkRun(exportOf([
      attempt('a', 'You have reached your usage limit. Try again later.'),
      attempt('b', 'Задание\n[RESPONSE_LIMIT] Объём ответа: 100 слов.'),
      attempt('c', long('X')), attempt('d', long('X'))
    ]));
    expect(flagsOf(rows, 'a')).toMatch(/сообщение о лимите/);
    expect(flagsOf(rows, 'b')).toMatch(/повторён запрос/);
    expect(flagsOf(rows, 'c')).toMatch(/тот же текст, что у D/);
  });

  test('берётся последняя попытка; отказ и незаконченная попытка отмечаются', () => {
    const rows = checkRun(exportOf([
      attempt('a', '', { accepted: false, reason: 'empty' }), attempt('a', long('A')),
      attempt('b', '', { accepted: false, reason: 'empty' }),
      attempt('c', '', { state: 'sent', accepted: undefined })
    ]));
    expect(rows.find((row) => row.participant === 'a')).toMatchObject({ flags: [], notes: ['с 2-й попытки'] });
    expect(flagsOf(rows, 'b')).toBe('ответ не принят: empty');
    expect(flagsOf(rows, 'c')).toBe('не закончен (sent)');
  });

  test('пропущенный участник начатого раунда; ход владельца и не начатый раунд не в счёт', () => {
    const round = (stepRef, kind, expectedParticipants) => ({ stepRef, kind, visit: 1, expectedParticipants, participants: [] });
    const rows = checkRun(exportOf([attempt('a', long('A'))], {
      rounds: [round('r1', 'round', ['a', 'b']), round('r2', 'round', ['a']), round('owner:check', 'owner', ['owner'])]
    }));
    expect(rows.map((row) => [row.ref, row.participant, row.flags.join()])).toEqual([
      ['r1', 'a', ''], ['r1', 'b', 'запрос не отправлялся']
    ]);
  });

  test('обязательные разделы берутся из настройки шага', () => {
    const output = { sections: ['Числа', 'Разногласия'] };
    const rows = checkRun(exportOf([attempt('a', `Числа\n${long('A')}`)], { output }));
    expect(rows[0].flags.join()).toMatch(/не по формату: missing_section/);
  });

  test('ничего не принимает за выгрузку, кроме прогона Basic', () => {
    expect(() => checkRun({})).toThrow(/не выгрузка прогона/);
  });

  test('карта идей: повторы, пропуски и неверные счётчики', () => {
    const good = ['И-1. Первая. — 1a', 'И-2. Вторая. — 1b, 2', '**И-3.** Третья. — 3', 'И-4. Четвёртая. — 4',
      'И-5. Пятая. — 5', 'Не идеи: 6',
      'Входных элементов — 6 | После атомизации — 7 | Уникальных идей — 5 | Объединено дубликатов — 1'].join('\n');
    expect(ideaProblems(good)).toEqual([]);
    const bad = ['И-1. Первая. — 1a', 'И-2. Вторая. — 1c, 2', 'И-2. Третья. — 2', 'И-5. Четвёртая. — 4',
      'И-6. Пятая. — 5', 'Уникальных идей — 9'].join('\n');
    const text = ideaProblems(bad).join('\n');
    expect(text).toMatch(/повторяются: И-2/);
    expect(text).toMatch(/пропущены номера идей.*И-3, И-4/);
    expect(text).toMatch(/стоят дважды: 2/);
    expect(text).toMatch(/нет исходных номеров: 3, 1b/);
    expect(text).toMatch(/заявлено 9, в списке 5/);
  });

  test('критика с номерами идей не проверяется как карта', () => {
    const critique = [2, 4, 7, 9, 12, 12].map((n) => `И-${n}. Возражение: данных мало.`).join('\n');
    expect(ideaProblems(critique)).toEqual([]);
  });

  test('обрыв: продолжение, код, документ; законченный текст не отмечается', () => {
    expect(cutProblem('Список\nПРОДОЛЖЕНИЕ СЛЕДУЕТ')).toMatch(/не закончен/);
    expect(cutProblem('```js\nconst a = 1;')).toMatch(/блок кода/);
    expect(cutProblem('[[DOC: plan]]\nтекст')).toMatch(/документ/);
    expect(cutProblem('Готово.\n[[AO-abc123]]')).toBeNull();
  });

  test('запуск из командной строки: коды выхода и --flagged', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-run-'));
    const write = (name, data) => { const file = path.join(dir, name); fs.writeFileSync(file, JSON.stringify(data)); return file; };
    const run = (...args) => {
      try { return { code: 0, out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: 'pipe' }) }; }
      catch (error) { return { code: error.status, out: error.stdout }; }
    };
    expect(run(write('ok.json', exportOf([attempt('a', long('A'))]))).code).toBe(0);
    const flagged = run('--flagged', write('bad.json', exportOf([attempt('a', long('A')), attempt('b', '')])));
    expect(flagged.code).toBe(1);
    expect(flagged.out).toMatch(/проверить: 1/);
    expect(flagged.out).not.toMatch(/\[a\]/);
    expect(run(write('other.json', {})).code).toBe(2);
    expect(run().code).toBe(2);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
