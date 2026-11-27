#!/bin/zsh
# Отправляет текст из файла в чат ChatGPT и проверяет, что сообщение ушло.
# usage: gpt-send.sh <url-substring> <message-file>
# exit: 0 отправлено; 1 не ушло; 3 нет вкладки; 5 идёт генерация (не отправлять поверх).
set -u
[[ $# -eq 2 && -f $2 ]] || { echo "usage: gpt-send.sh <url-substring> <message-file>" >&2; exit 2; }
D=${0:A:h}; NEEDLE=$1; JS=$(mktemp -t gptsend).js
# печатает: число сообщений, ключ последнего хода (или -), длину черновика в поле
state() { "$D/tab-js.sh" "$NEEDLE" "$D/gpt-state.js" | python3 -I -c 'import json,sys;d=json.loads(sys.stdin.read());print(d["users"],d["turn"] or "-",d["draft"])' 2>/dev/null; }
python3 -I - "$2" "$JS" "$D/gpt-type.js" <<'PY'
import json,sys
read=lambda p:open(p,encoding='utf-8').read().strip()
open(sys.argv[2],'w',encoding='utf-8').write(read(sys.argv[3])+'('+json.dumps(read(sys.argv[1]))+')')
PY
before=(${=$(state)}); (( $#before == 3 )) || { echo "NO_TAB"; rm -f "$JS"; exit 3; }
r=$("$D/tab-js.sh" "$NEEDLE" "$JS"); rm -f "$JS"
case $r in BUSY) echo "BUSY"; exit 5;; NO_TAB) echo "NO_TAB"; exit 3;; TYPED) ;; *) echo "$r"; exit 1;; esac
for i in 1 2 3 4 5 6; do
  sleep 2; now=(${=$(state)}); (( $#now == 3 )) || continue
  if (( now[3] == 0 )) && { (( now[1] > before[1] )) || [[ $now[2] != $before[2] ]]; }; then
    print -r -- "$now[2]" > "${TMPDIR:-/tmp}/gpt-sent-${NEEDLE//[^A-Za-z0-9-]/_}"  # gpt-watch заберёт и уже готовый ответ
    echo "ОТПРАВЛЕНО"; exit 0
  fi
done
echo "НЕ УШЛО: текст в поле, кнопка не сработала"; exit 1
