#!/bin/bash
# bash visit.sh <окно/вкладка> [секунд на вкладке, по умолчанию 5]
# Выводит вкладку на передний план, прокручивает вниз, держит её в фокусе. Нужно, чтобы сайт не замораживал генерацию в фоне.
D="$(cd "$(dirname "$0")" && pwd)"; ADDR="$1"; SEC="${2:-5}"
osascript - "$ADDR" <<'OSA'
on run argv
 set addr to item 1 of argv
 tell application "Google Chrome"
  if addr contains "/" and addr does not contain "." then
   set AppleScript's text item delimiters to "/"
   set w to (text item 1 of addr) as integer
   set t to (text item 2 of addr) as integer
   set active tab index of window w to t
   set index of window w to 1
  else
   repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
     if URL of tab t of window w contains addr then
      set active tab index of window w to t
      set index of window w to 1
     end if
    end repeat
   end repeat
  end if
  activate
 end tell
end run
OSA
sleep 1; bash "$D/tab.sh" "$ADDR" down >/dev/null; sleep "$SEC"
