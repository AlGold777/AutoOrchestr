const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'agent', 'gpt-watch.sh');
// Вместо вкладки Chrome: первый опрос — старый ответ, дальше — новый законченный.
const TAB_STUB = `#!/bin/zsh
D=\${0:A:h}
if [[ \${2:t} == gpt-last.js ]]; then print -r -- 'ВОЗРАЖЕНИЕ: строка 1'; print -r -- 'строка \\n $HOME 2'; exit 0; fi
if [[ -f $D/seen ]]; then print -r -- '{"answers":2,"generating":false,"lastLen":9,"turn":"b"}'
else : > $D/seen; print -r -- '{"answers":1,"generating":false,"lastLen":3,"turn":"a"}'; fi
`;

(fs.existsSync('/bin/zsh') ? describe : describe.skip)('gpt-watch: ответ GPT в файл отчёта', () => {
  const setup = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gpt-watch-'));
    fs.copyFileSync(SCRIPT, path.join(dir, 'gpt-watch.sh'));
    fs.writeFileSync(path.join(dir, 'tab-js.sh'), TAB_STUB, { mode: 0o755 });
    return dir;
  };
  const watch = (dir, args) => execFileSync('/bin/zsh', [path.join(dir, 'gpt-watch.sh'), ...args], { stdio: 'pipe', env: { ...process.env, TMPDIR: dir } });

  test('--append дописывает ответ дословно после прежнего текста', () => {
    const dir = setup();
    const out = path.join(dir, 'answer.txt');
    const report = path.join(dir, 'report.md');
    fs.writeFileSync(report, '# Отчёт\n');
    watch(dir, ['chat', out, '0', '--append', report]);
    const answer = fs.readFileSync(out, 'utf8');
    expect(answer).toBe('ВОЗРАЖЕНИЕ: строка 1\nстрока \\n $HOME 2\n');
    expect(fs.readFileSync(report, 'utf8')).toBe(`# Отчёт\n\n### Ответ GPT\n\n${answer}`);
  });

  test('нет папки файла отчёта — код 2 до ожидания', () => {
    const dir = setup();
    let status = 0;
    try { watch(dir, ['chat', path.join(dir, 'a.txt'), '0', '--append', path.join(dir, 'нет', 'r.md')]); } catch (error) { status = error.status; }
    expect(status).toBe(2);
    expect(fs.existsSync(path.join(dir, 'seen'))).toBe(false);
  });
});
