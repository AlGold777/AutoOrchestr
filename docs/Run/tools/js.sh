#!/bin/bash
# Run a JS file in a Chrome tab (macOS, Chrome > View > Developer > Allow JavaScript from Apple Events).
# usage: bash docs/Run/tools/js.sh <file.js> [url-fragment]   (default fragment: pipeline_panel.html; the LAST matching tab is used)
PAT="${2:-pipeline_panel.html}"
osascript <<OSA
set js to (do shell script "cat " & quoted form of "$1")
tell application "Google Chrome"
 set found to missing value
 repeat with w in windows
  repeat with t in tabs of w
   if URL of t contains "$PAT" then set found to t
  end repeat
 end repeat
 if found is missing value then return "NO TAB"
 return (execute found javascript js)
end tell
OSA
