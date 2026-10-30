-- Close Chrome's downloads bubble (left open after "Basic" exports): Escape in the front Chrome window.
tell application "Google Chrome" to activate
delay 0.4
tell application "System Events" to key code 53
