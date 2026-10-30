-- Reload every open model tab (do this after reloading the extension, before a run).
tell application "Google Chrome"
 set n to 0
 repeat with w in windows
  repeat with t in tabs of w
   set u to URL of t
   if (u contains "chatgpt.com") or (u contains "gemini.google") or (u contains "chat.deepseek") or (u contains "perplexity.ai") or (u contains "claude.ai") or (u contains "chat.qwen") or (u contains "kimi") then
     tell t to reload
     set n to n + 1
   end if
  end repeat
 end repeat
 return n & " model tabs reloaded"
end tell
