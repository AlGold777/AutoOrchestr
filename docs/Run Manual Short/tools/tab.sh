#!/bin/bash
# bash tab.sh <окно/вкладка, например 1/19, или фрагмент адреса> <state|paste|send|read|top> [файл для paste]
# Нужно: Chrome → Вид → Для разработчиков → «Разрешить JavaScript из событий Apple».
D="$(cd "$(dirname "$0")" && pwd)"; ADDR="$1"; CMD="$2"; FILE="$3"
case "$CMD" in
 paste) CALL="window.__M.paste(decodeURIComponent(escape(atob('$(base64 < "$FILE" | tr -d '\n')'))))";;
 click) CALL="window.__M.click(decodeURIComponent(escape(atob('$(printf '%s' "$FILE" | base64 | tr -d '\n')'))))";;
 *) CALL="window.__M.$CMD()";;
esac
JS="$(cat "$D/lib.js"); $CALL"
osascript - "$ADDR" "$JS" <<'OSA'
on run argv
 set addr to item 1 of argv
 set js to item 2 of argv
 tell application "Google Chrome"
  if addr contains "/" and addr does not contain "." then
   set AppleScript's text item delimiters to "/"
   set w to (text item 1 of addr) as integer
   set t to (text item 2 of addr) as integer
   return (execute tab t of window w javascript js)
  end if
  set found to missing value
  repeat with w in windows
   repeat with t in tabs of w
    if URL of t contains addr then set found to t
   end repeat
  end repeat
  if found is missing value then return "NO TAB"
  return (execute found javascript js)
 end tell
end run
OSA
