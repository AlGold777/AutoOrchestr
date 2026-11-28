#!/bin/bash
# Сторож отдела TheCycle. Работает сам, без сессии Claude. Раз в 30 с читает: последнюю штатную копию,
# панель (идёт ли прогон Basic), чат архитектора. Пишет ~/Documents/TheCycle-ops/{status.md,ALERT.md}.
# Запуск: scripts/agent/watchdog.sh  (под launchd: com.autoorch.watchdog). Одно срабатывание — одна запись в ALERT.md.
R=/Users/restart/Documents/GitHub/AutoOrchestr; O=$HOME/Documents/TheCycle-ops; B=$HOME/Documents/TheCycle-backups
STALL_MIN=${STALL_MIN:-15}; mkdir -p "$O"; cd "$R" || exit 1
ARCH_NEEDLE=$(cat "$O/architect-needle" 2>/dev/null)   # подстрока адреса чата архитектора; файл вне репозитория
RUNJS=$(mktemp "$O/run.XXXX.js"); cat > "$RUNJS" <<'JS'
(()=>{const b=document.querySelector('#debate-run-toggle-btn');return JSON.stringify({run:!!b&&/Остановить/.test(b.title||''),modal:[...document.querySelectorAll('dialog[open],[role=dialog]')].filter(e=>e.offsetParent).length})})()
JS
alert(){ # $1 вид, $2 текст; не повторять одно и то же подряд
  [[ "$(cat "$O/last-alert" 2>/dev/null)" == "$1|$2" ]] && return
  echo "$1|$2" > "$O/last-alert"
  printf '## %s %s\n%s\n\n' "$(date '+%d.%m %H:%M')" "$1" "$2" >> "$O/ALERT.md"; cp "$O/ALERT.md" "$O/ALERT.current" 2>/dev/null
  osascript -e "display notification \"$2\" with title \"TheCycle: $1\"" >/dev/null 2>&1; }
last=""; since=$(date +%s); gptturn=""
while true; do
  now=$(date +%s)
  f=$(ls -t "$B"/thecycle-circle-*.thecycle.json 2>/dev/null | head -1)
  cur=$([[ -n "$f" ]] && node scripts/agent/run-digest.js "$f" 2>/dev/null | sed -n 3p)
  ui=$(scripts/agent/tab-js.sh pipeline_panel "$RUNJS" 2>/dev/null)
  run=$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1])["run"])' "$ui" 2>/dev/null || echo "?")
  modal=$(python3 -I -c 'import json,sys;print(json.loads(sys.argv[1])["modal"])' "$ui" 2>/dev/null || echo "?")
  [[ "$cur|$run" != "$last" ]] && { last="$cur|$run"; since=$now; }
  idle=$(( (now-since)/60 ))
  g=""; if [[ -n "$ARCH_NEEDLE" ]]; then g=$(scripts/agent/tab-js.sh "$ARCH_NEEDLE" scripts/agent/gpt-state.js 2>/dev/null | python3 -I -c 'import json,sys;d=json.loads(sys.stdin.read());print(d["turn"][:8],d["generating"])' 2>/dev/null); fi
  printf 'обновлено: %s\nпрогон Basic идёт: %s\nокон на панели: %s\nисследование: %s\nбез изменений: %s мин\nчат архитектора: %s\n' "$(date '+%d.%m %H:%M:%S')" "$run" "$modal" "$cur" "$idle" "$g" > "$O/status.md"
  case "$cur" in
    *COMPLETED*) alert DONE "Исследование завершено: $cur"; [[ -x scripts/agent/ops-start.sh ]] && scripts/agent/ops-start.sh auto >> "$O/start.log" 2>&1 ;;
    *PAUSED*)    alert PAUSED "Пауза: $cur. Диагноз: дежурный (docs/TheCycle/ops/roles/duty.md)";;
  esac
  [[ "$modal" != "0" && "$modal" != "?" ]] && alert MODAL "На панели открыто окно ($modal). Прочитать и закрыть по docs/Agents/agent-live-test.md"
  [[ "$run" == "False" && "$cur" == *RUNNING* ]] && alert DEAD "Фаза RUNNING, а прогон Basic не идёт: $cur"
  [[ "$run" == "True" && $idle -ge $STALL_MIN ]] && alert STALL "Прогон идёт, но $idle мин без изменений: $cur"
  if [[ -n "$g" && "$g" != "$gptturn" ]]; then [[ -n "$gptturn" && "$g" == *False ]] && alert GPT_REPLY "Архитектор ответил (ход ${g%% *})"; gptturn="$g"; fi
  sleep 30
done
