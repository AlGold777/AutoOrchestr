#!/bin/zsh
# Тесты, коммит и доставка правки в основной чекаут одной командой.
# Запускать из worktree (или из основного чекаута — тогда без слияния).
#
# usage: deliver.sh [--docs] "<сообщение коммита>" <путь> [<путь>...]
#        deliver.sh --next-version      -> печатает версию для записи в CHANGELOG
#   --docs  только тесты документации (для правок без кода).
#
# Шаги: добавить в коммит только названные пути -> если среди них есть код, поднять
# версию в manifest.json и package.json до следующей после рабочей линии и потребовать
# docs/CHANGELOG.md -> коммит -> rebase на рабочую линию -> тесты -> ff-слияние в
# основной чекаут -> сверка версии и HEAD. Последняя строка: ДОСТАВЛЕНО … или НЕ доставлено: ….
# Любая ошибка останавливает скрипт; коммит остаётся в ветке, разбираться ведущему.
set -u
MAIN=${AO_MAIN:-/Users/restart/Documents/GitHub/AutoOrchestr}
WT=$(git rev-parse --show-toplevel) || exit 2
LINE=$(git -C "$MAIN" branch --show-current)
fail() { echo "НЕ доставлено: $*"; exit 1; }
[[ -n $LINE ]] || fail "основной чекаут $MAIN не на ветке (detached HEAD)"
ver_of() { python3 -I -c 'import json,sys;print(json.load(sys.stdin)["version"])'; }
line_ver() { git -C "$MAIN" show "$LINE:manifest.json" | ver_of; }
next_ver() { local v=$(line_ver); print -r -- "${v%.*}.$(( ${v##*.} + 1 ))"; }

if [[ ${1:-} == --next-version ]]; then next_ver; exit 0; fi
DOCS=0; [[ ${1:-} == --docs ]] && { DOCS=1; shift; }
[[ $# -ge 2 ]] || { echo "usage: deliver.sh [--docs] \"<сообщение>\" <путь>..." >&2; exit 2; }
MSG=$1; shift; PATHS=("$@")
cd "$WT"
BR=$(git branch --show-current)
[[ -n $(git diff --cached --name-only) ]] && fail "в индексе уже есть чужие изменения: $(git diff --cached --name-only | tr '\n' ' ')"

# 1. Код или только документы
CODE=0
for p in "${PATHS[@]}"; do [[ $p == docs/* || $p == *.md ]] || CODE=1; done
(( CODE && DOCS )) && fail "--docs, но среди путей есть код"

# 2. Версия
if (( CODE )); then
  NV=$(next_ver) && [[ -n $NV ]] || fail "не удалось определить версию рабочей линии $LINE"
  CUR=$(ver_of < manifest.json)
  if [[ $CUR != $NV ]]; then
    python3 -I - "$NV" <<'PY' || fail "не удалось записать версию"
import json,re,sys
v=sys.argv[1]
for f in ('manifest.json','package.json'):
    s=open(f,encoding='utf-8').read()
    s2=re.sub(r'("version"\s*:\s*")[^"]+(")', lambda m:m.group(1)+v+m.group(2), s, count=1)
    open(f,'w',encoding='utf-8').write(s2)
PY
  fi
  grep -qF -- "$NV" docs/CHANGELOG.md || fail "в docs/CHANGELOG.md нет записи о версии $NV (узнать номер: deliver.sh --next-version)"
  PATHS+=(manifest.json package.json docs/CHANGELOG.md)
fi

# 3. Коммит
git add -- "${PATHS[@]}" || fail "git add"
[[ -z $(git diff --cached --name-only) ]] && fail "нечего коммитить"
git commit -q -m "$MSG" || fail "git commit"

# 4. Догнать рабочую линию
if [[ $WT != $MAIN ]] && ! git merge-base --is-ancestor "$LINE" HEAD; then
  [[ -z $(git status --porcelain --untracked-files=no) ]] || fail "rebase невозможен: в worktree есть чужие незакоммиченные правки ($(git status --porcelain --untracked-files=no | head -5 | tr '\n' ' ')); коммит в ветке $BR"
  git rebase -q "$LINE" >/dev/null 2>&1 || { git rebase --abort 2>/dev/null; fail "rebase на $LINE с конфликтом; коммит в ветке $BR"; }
fi

# 5. Тесты
LOG=$(mktemp -t deliver).log
if (( DOCS )); then
  npx jest -c tests/jest.config.js tests/basic-docs-refs.test.js tests/basic-schema-guide.test.js >"$LOG" 2>&1 || fail "тесты документации: $(grep -E '^Tests:' "$LOG"); лог $LOG"
  T="документация: $(grep -E '^Tests:' "$LOG" | sed 's/Tests: *//')"
else
  npx jest -c tests/jest.config.js --silent >"$LOG" 2>&1 || fail "jest: $(grep -E '^(Test Suites|Tests):' "$LOG" | tr '\n' ' '); лог $LOG"
  J=$(grep -E '^Test Suites:' "$LOG" | sed 's/Test Suites: *//')
  npm run -s test:thecycle >"$LOG.tc" 2>&1 || fail "test:thecycle: $(grep -E '^# (pass|fail)' "$LOG.tc" | tr '\n' ' '); лог $LOG.tc"
  T="jest $J; thecycle $(grep -E '^# pass' "$LOG.tc" | sed 's/# //')"
fi

# 6. Доставка
if [[ $WT != $MAIN ]]; then
  git -C "$MAIN" merge -q --ff-only "$BR" 2>"$LOG.merge" || fail "ff-слияние в $LINE: $(head -3 "$LOG.merge" | tr '\n' ' ')"
fi
MV=$(ver_of < "$MAIN/manifest.json"); WV=$(ver_of < manifest.json)
[[ $(git -C "$MAIN" rev-parse HEAD) == $(git rev-parse HEAD) ]] || fail "HEAD основного чекаута не совпал с веткой"
[[ $MV == $WV ]] || fail "версия в основном чекауте $MV, ожидалась $WV"
echo "ДОСТАВЛЕНО $MV $(git rev-parse --short HEAD) | тесты: $T"
(( CODE )) && echo "Перезагрузить расширение: chrome://extensions → Reload"
exit 0
