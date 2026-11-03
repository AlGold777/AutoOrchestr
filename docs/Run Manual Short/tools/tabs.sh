#!/bin/bash
# Список вкладок обычного Chrome: окно/номер адрес
osascript <<'OSA'
tell application "Google Chrome"
 set r to ""
 repeat with w from 1 to count of windows
  repeat with t from 1 to count of tabs of window w
   set r to r & w & "/" & t & " " & (URL of tab t of window w) & linefeed
  end repeat
 end repeat
 return r
end tell
OSA
