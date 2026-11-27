#!/bin/zsh
# Выполняет JS-файл в первой вкладке Chrome, чей URL содержит подстроку; печатает результат.
# usage: tab-js.sh <url-substring> <js-file>     -> результат JS или NO_TAB
[[ $# -eq 2 && -f $2 ]] || { echo "usage: tab-js.sh <url-substring> <js-file>" >&2; exit 2; }
osascript - "$1" "${2:A}" <<'AS'
on run argv
 set needle to item 1 of argv
 set js to read POSIX file (item 2 of argv) as «class utf8»
 if application "Google Chrome" is not running then return "NO_TAB"
 tell application "Google Chrome"
  repeat with w in windows
   repeat with t in tabs of w
    if URL of t contains needle then return execute t javascript js
   end repeat
  end repeat
 end tell
 return "NO_TAB"
end run
AS
