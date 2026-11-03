#!/bin/bash
# bash save.sh <окно/вкладка> <файл.md>  — сохраняет последний ответ и сверяет длину с тем, что на странице.
D="$(cd "$(dirname "$0")" && pwd)"
S0="$(bash "$D/tab.sh" "$1" state)"
case "$S0" in
 *chatgpt.com*|*chat.deepseek.com*)
  # у этих сайтов кнопка «Копировать» отдаёт настоящий markdown (таблицы, код); читаем буфер в UTF-8
  for TRY in 1 2 3; do
   bash "$D/visit.sh" "$1" 1
   printf 'M_EMPTY' | pbcopy
   [ "$(bash "$D/tab.sh" "$1" copy)" = "clicked copy" ] || continue
   sleep 1.5; LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 pbpaste > "$2.copy"
   if [ "$(cat "$2.copy")" != "M_EMPTY" ] && tail -c 400 "$2.copy" | grep -q "КОНЕЦ-ОТВЕТА"; then
    mv "$2.copy" "$2"; N="$(python3 -c "import sys,re;print(len(re.sub(r'\\s','',open(sys.argv[1],encoding='utf-8').read())))" "$2")"
    P="$(bash "$D/tab.sh" "$1" size)"
    [ "$N" -ge $(( P * 9 / 10 )) ] && { echo "OK-COPY $N (markdown из кнопки «Копировать»; на странице без разметки $P)"; exit 0; }
   fi
   sleep 3
  done
   rm -f "$2.copy"
  ;;
esac
bash "$D/tab.sh" "$1" read > "$2"
N="$(python3 -c "import sys,re;print(len(re.sub(r'\s','',open(sys.argv[1],encoding='utf-8').read())))" "$2")"
P="$(bash "$D/tab.sh" "$1" size)"
[ "$N" = "$P" ] && echo "OK $N" || echo "MISMATCH файл=$N страница=$P"
if [ "$N" -gt 500 ] && [ "$(wc -l < "$2")" -lt 3 ]; then echo "WARN плоский текст без переводов строк"; fi
