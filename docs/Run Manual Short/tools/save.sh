#!/bin/bash
# bash save.sh <окно/вкладка> <файл.md>  — сохраняет последний ответ и сверяет длину с тем, что на странице.
D="$(cd "$(dirname "$0")" && pwd)"
bash "$D/tab.sh" "$1" read > "$2"
N="$(python3 -c "import sys,re;print(len(re.sub(r'\s','',open(sys.argv[1],encoding='utf-8').read())))" "$2")"
P="$(bash "$D/tab.sh" "$1" size)"
[ "$N" = "$P" ] && echo "OK $N" || echo "MISMATCH файл=$N страница=$P"
if [ "$N" -gt 500 ] && [ "$(wc -l < "$2")" -lt 3 ]; then echo "WARN плоский текст без переводов строк"; fi
