#!/bin/bash
# bash attach-qwen.sh <окно/вкладка> <полный путь к файлу>
# Qwen не принимает файл, подставленный в скрытое поле. Нужен настоящий путь: «+» → «Загрузить вложение» → окно выбора файла macOS.
# Печатает ATTACHED или NOT_ATTACHED <причина>. Требуется «Универсальный доступ» для osascript.
D="$(cd "$(dirname "$0")" && pwd)"; A="$1"; P="$2"; NAME="$(basename "$P")"
[ -f "$P" ] || { echo "NOT_ATTACHED файла нет: $P"; exit 1; }
click_at(){ osascript -l JavaScript "$D/../../Run Automation/tools/realclick.js" $1 $2 >/dev/null; }
bash "$D/visit.sh" "$A" 1
C="$(bash "$D/tab.sh" "$A" rect "Выбрать режим")"; [ "$C" = "NO MATCH" ] && { echo "NOT_ATTACHED кнопка «+» не найдена"; exit 1; }
click_at $C; sleep 1.2
C="$(bash "$D/tab.sh" "$A" rect "Загрузить вложение")"; [ "$C" = "NO MATCH" ] && { echo "NOT_ATTACHED пункт «Загрузить вложение» не найден"; exit 1; }
click_at $C; sleep 2
printf '%s' "$P" | LANG=en_US.UTF-8 pbcopy
osascript <<'OSA'
tell application "System Events"
 keystroke "g" using {command down, shift down}
 delay 1
 keystroke "v" using {command down}
 delay 1
 key code 36
 delay 1.5
 key code 36
end tell
OSA
for i in $(seq 1 20); do
 sleep 1
 [ "$(bash "$D/tab.sh" "$A" attached "$NAME")" = yes ] && { echo ATTACHED; exit 0; }
done
osascript -e 'tell application "System Events" to key code 53'
echo "NOT_ATTACHED карточка файла не появилась"; exit 1
