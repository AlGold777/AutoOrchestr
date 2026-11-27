#!/bin/bash
# Хук PreToolUse: главной сессии (ведущему) запрещено исполнять; агентам разрешено всё.
# Любая внутренняя ошибка — allow.
INPUT="$(cat 2>/dev/null)"
LOG="${TMPDIR:-/tmp}/ao-lead-guard.log"
RES="$(printf '%s' "$INPUT" | python3 -I -c '
import sys, json, os
try:
    d = json.loads(sys.stdin.read())
    tool = str(d.get("tool_name") or "")
    aid = "yes" if d.get("agent_id") else "no"
    ti = d.get("tool_input") or {}
    path = ti.get("file_path") or ti.get("notebook_path") or ""
    dec = "allow"
    if aid == "no" and tool in ("Bash", "Edit", "Write", "NotebookEdit"):
        dec = "deny"
        if tool != "Bash" and path:
            rp = os.path.realpath(os.path.expanduser(str(path)))
            base = os.path.realpath(os.path.expanduser("~/.claude/projects")) + os.sep
            if rp.startswith(base):
                parts = rp[len(base):].split(os.sep)
                if len(parts) >= 3 and parts[1] == "memory":
                    dec = "allow"
    print(tool, aid, dec)
except Exception:
    print("? ? allow")
' 2>/dev/null)"
[ -z "$RES" ] && RES="? ? allow"
set -- $RES
TOOL="$1"; AID="$2"; DEC="$3"
[ "$AO_LEAD_GUARD" = "off" ] && DEC="allow"
echo "$(date '+%Y-%m-%d %H:%M:%S') tool=$TOOL agent_id=$AID $DEC" >> "$LOG" 2>/dev/null
if [ "$DEC" = "deny" ]; then
  echo "Ведущему запрещено исполнять ($TOOL). Передай работу агенту: Sonnet — код, документы, review; Haiku — тесты, коммиты, механика. Правило — AGENTS.md." >&2
  exit 2
fi
exit 0
