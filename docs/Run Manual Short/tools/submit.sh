#!/bin/bash
# bash submit.sh <окно/вкладка> <файл с запросом>
# Один запрос в одну вкладку: фокус → вставка → ожидание кнопки → отправка → проверка → 5 с на вкладке. Ответа не ждёт.
# Печатает SENT или NOT_SENT <причина>.
D="$(cd "$(dirname "$0")" && pwd)"; A="$1"; F="$2"; t(){ bash "$D/tab.sh" "$A" "$@"; }
N="$(python3 -c "import sys;print(len(open(sys.argv[1],encoding='utf-8').read()))" "$F")"
bash "$D/visit.sh" "$A" 1
R="$(t paste "$F")"; echo "$R"
case "$R" in "pasted $N of $N") ;; *) echo "NOT_SENT вставка не совпала"; exit 1;; esac
for i in 1 2 3 4 5 6; do case "$(t state)" in *'"sendEnabled":true'*) break;; esac; sleep 0.5; done
case "$(t state)" in *'"sendEnabled":true'*) ;; *) printf '%s ' "$(cat "$F")" > /tmp/m_space.txt; t paste /tmp/m_space.txt >/dev/null; sleep 1;; esac
case "$(t state)" in *'"sendEnabled":true'*) ;; *) echo "NOT_SENT кнопка отправки не включилась (длинный запрос или лимит)"; exit 1;; esac
t send; sleep 4; S="$(t state)"
case "$S" in *'"composerLen":0'*|*'"composerLen":1,'*|*'"stopVisible":true'*) echo "SENT";; *) echo "NOT_SENT запрос остался в поле: $S";; esac
bash "$D/visit.sh" "$A" 5
