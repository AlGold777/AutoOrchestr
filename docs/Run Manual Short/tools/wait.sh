#!/bin/bash
# bash wait.sh <секунд> <окно/вкладка> [ещё вкладки...]
# Каждые 20 с печатает по строке на вкладку. Выходит, когда у всех ответ закончен (последняя строка КОНЕЦ-ОТВЕТА, длина не менялась два опроса) или вышло время.
D="$(cd "$(dirname "$0")" && pwd)"; END=$((SECONDS+$1)); shift
W="$(mktemp -d)"
while :; do
 ALL=1
 for A in "$@"; do
  S="$(bash "$D/tab.sh" "$A" state)"
  L="$(echo "$S" | sed -n 's/.*"lastLen":\([0-9]*\).*/\1/p')"
  K="$W/$(echo "$A" | tr -c 'A-Za-z0-9' _)"; P="$(cat "$K.p" 2>/dev/null)"; N="$(cat "$K.n" 2>/dev/null || echo 0)"; N=${N:-0}
  case "$S" in *'"lastEnds":true'*) [ "$L" = "$P" ] && N=$((N+1)) || N=0;; *) N=0;; esac
  echo "$L" > "$K.p"; echo "$N" > "$K.n"
  if [ "$N" -ge 2 ]; then ST=DONE; else ST=GENERATING; ALL=0; fi
  case "$S" in *'"limit":""'*) ;; *'"limit":'*) ST="$ST LIMIT";; esac
  case "$S" in *'"dialog":""'*) ;; *'"dialog":'*) ST="$ST DIALOG";; esac
  echo "$A $ST len=$L $(echo "$S" | sed -n 's/.*"stopVisible":\([a-z]*\).*/stop=\1/p') $(echo "$S" | sed -n 's/.*"hidden":\([a-z]*\).*/hidden=\1/p')"
 done
 [ $ALL = 1 ] && { echo ALL_DONE; exit 0; }
 [ $SECONDS -ge $END ] && { echo TIMEOUT; exit 0; }
 echo ---; sleep 20
done
