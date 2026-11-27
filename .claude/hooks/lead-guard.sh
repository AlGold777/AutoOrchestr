#!/bin/bash
# Хук PreToolUse: главной сессии на модели Opus (ведущему) запрещено исполнять;
# агентам и сессиям на других моделях разрешено всё.
# Модель главной сессии берётся из журнала (transcript_path). Любая внутренняя ошибка — allow.
INPUT="$(cat 2>/dev/null)"
LOG="${TMPDIR:-/tmp}/ao-lead-guard.log"
RES="$(printf '%s' "$INPUT" | python3 -I -c '
import sys, json, os
def last_model(p):
    # читаем файл с конца блоками, ищем последнюю строку с message.model
    try:
        with open(p, "rb") as f:
            f.seek(0, 2)
            pos = f.tell()
            buf = b""
            while pos > 0:
                step = min(65536, pos)
                pos -= step
                f.seek(pos)
                buf = f.read(step) + buf
                lines = buf.split(b"\n")
                # первая строка может быть неполной, пока не дошли до начала
                rest = lines[1:] if pos > 0 else lines
                for ln in reversed(rest):
                    if b"\"model\"" not in ln:
                        continue
                    try:
                        m = (json.loads(ln).get("message") or {}).get("model")
                    except Exception:
                        continue
                    if m:
                        return str(m)
                if pos > 0:
                    buf = lines[0]
                else:
                    break
    except Exception:
        pass
    return ""
try:
    d = json.loads(sys.stdin.read())
    tool = str(d.get("tool_name") or "")
    aid = "yes" if d.get("agent_id") else "no"
    ti = d.get("tool_input") or {}
    path = ti.get("file_path") or ti.get("notebook_path") or ""
    model = ""
    dec = "allow"
    if aid == "no" and tool in ("Bash", "Edit", "Write", "NotebookEdit"):
        tp = d.get("transcript_path") or ""
        model = last_model(str(tp)) if tp else ""
        if "opus" in model.lower():
            dec = "deny"
            if tool != "Bash" and path:
                rp = os.path.realpath(os.path.expanduser(str(path)))
                base = os.path.realpath(os.path.expanduser("~/.claude/projects")) + os.sep
                if rp.startswith(base):
                    parts = rp[len(base):].split(os.sep)
                    if len(parts) >= 3 and parts[1] == "memory":
                        dec = "allow"
    print(tool, aid, dec, model or "unknown")
except Exception:
    print("? ? allow unknown")
' 2>/dev/null)"
[ -z "$RES" ] && RES="? ? allow unknown"
set -- $RES
TOOL="$1"; AID="$2"; DEC="$3"; MODEL="$4"
[ "$AO_LEAD_GUARD" = "off" ] && DEC="allow"
echo "$(date '+%Y-%m-%d %H:%M:%S') tool=$TOOL agent_id=$AID model=$MODEL $DEC" >> "$LOG" 2>/dev/null
if [ "$DEC" = "deny" ]; then
  echo "Ведущему (Opus) запрещено исполнять ($TOOL). Передай работу сессии этапа на Sonnet или агенту: Sonnet — код, документы, review; Haiku — тесты, коммиты, механика. Правило — AGENTS.md." >&2
  exit 2
fi
exit 0
