#!/bin/bash
# Close Chrome's downloads bubble left open after a "Basic" export: a real click on the toolbar download icon toggles it.
# Keys (System Events Escape) are not allowed for osascript on this Mac; real mouse events work only when run from the app's Terminal tab
# (mcp__terminal__run_in_terminal), not from the Bash tool. Coordinates are points on the 1168-wide screen: icon at (1075,91) in a maximised Chrome window.
# Always verify with: screencapture -x -R0,0,1168,330 /tmp/x.png  (the bubble must be gone).
T="$(cd "$(dirname "$0")" && pwd)"
osascript -e 'tell application "Google Chrome" to activate'; sleep 0.8
osascript -l JavaScript "$T/realclick.js" "${1:-1075}" "${2:-91}"
