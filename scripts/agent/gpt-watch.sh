#!/bin/zsh
# Ждёт новый законченный ответ в чате ChatGPT и завершается только на событии.
# Запускать в фоне: завершение будит ведущего, пустых проверок нет.
# usage: gpt-watch.sh <url-substring> <out-file> [interval-sec=30] [timeout-min=240] [--append <файл>]
#   Новый ответ — новый ход (или выросло число ответов) относительно старта; ответ на только
#   что отправленное gpt-send.sh считается новым, даже если уже готов. Ответ законченный, если
#   генерации нет и длина не менялась между двумя опросами. Полный текст ответа -> <out-file>.
#   --append: тот же ответ дословно дописать в конец файла (отчёт этапа) под заголовком «Ответ GPT».
# exit: 0 новый ответ; 2 неверный вызов или нет папки файла --append; 3 вкладка не найдена 10 раз подряд;
#       4 тайм-аут; 5 ответ получен, но не дописан в файл --append (он остаётся в <out-file>).
set -u
usage() { echo "usage: gpt-watch.sh <url-substring> <out-file> [interval] [timeout-min] [--append <файл>]" >&2; exit 2; }
ARGS=(); APP=
while (( $# )); do
  if [[ $1 == --append ]]; then [[ -n ${2:-} && -d ${2:h} ]] || usage; APP=$2; shift 2; else ARGS+=("$1"); shift; fi
done
(( ${#ARGS} >= 2 )) || usage
D=${0:A:h}; NEEDLE=$ARGS[1]; OUT=$ARGS[2]; IV=${ARGS[3]:-30}; TMO=$(( ${ARGS[4]:-240} * 60 ))
state() { "$D/tab-js.sh" "$NEEDLE" "$D/gpt-state.js"; }
field() { python3 -I -c 'import json,sys;d=json.loads(sys.stdin.read());print(d[sys.argv[1]])' "$1"; }
s=$(state); [[ $s == NO_TAB || $s != \{* ]] && { echo "NO_TAB"; exit 3; }
BASE=$(print -r -- "$s" | field answers); BTURN=$(print -r -- "$s" | field turn)
SENT=${TMPDIR:-/tmp}/gpt-sent-${NEEDLE//[^A-Za-z0-9-]/_}
# идущий и ещё не забранный ответ тоже ждём
if [[ $(print -r -- "$s" | field generating) == True || ( -f $SENT && -n $BTURN && $(<$SENT) == $BTURN ) ]]; then (( BASE-- )); BTURN=-; fi
prevLen=-1; miss=0; t0=$SECONDS
echo "база: ответов $BASE"
while (( SECONDS - t0 < TMO )); do
  sleep "$IV"
  s=$(state)
  if [[ $s == NO_TAB || $s != \{* ]]; then (( ++miss >= 10 )) && { echo "NO_TAB"; exit 3; }; continue; fi
  miss=0
  n=$(print -r -- "$s" | field answers) || continue; g=$(print -r -- "$s" | field generating); len=$(print -r -- "$s" | field lastLen); turn=$(print -r -- "$s" | field turn)
  [[ $n == <-> && $len == <-> ]] || continue
  if { (( n > BASE )) || [[ -n $turn && $turn != $BTURN ]]; } && [[ $g == False ]] && (( len == prevLen && len > 0 )); then
    "$D/tab-js.sh" "$NEEDLE" "$D/gpt-last.js" > "$OUT.tmp"
    [[ $(head -c 6 "$OUT.tmp") == NO_TAB ]] && { rm -f "$OUT.tmp"; prevLen=-1; continue; }
    mv "$OUT.tmp" "$OUT"; rm -f "$SENT"
    if [[ -n $APP ]]; then
      { print -r -- $'\n### Ответ GPT\n' && cat "$OUT"; } >> "$APP" || { echo "НЕ ДОПИСАНО в $APP; ответ в $OUT"; exit 5; }
    fi
    echo "НОВЫЙ ОТВЕТ: ответов $n, символов $len -> $OUT"; exit 0
  fi
  prevLen=$len
done
echo "ТАЙМ-АУТ"; exit 4
