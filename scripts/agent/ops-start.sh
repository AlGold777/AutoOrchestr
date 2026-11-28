#!/bin/bash
# Запуск исследования из очереди: scripts/agent/ops-start.sh <id|next|auto>; auto берёт только элементы с autostart:true. Очередь: docs/TheCycle/ops/queue.json.
# Выбирает схему в списке панели, вводит задачу и лимит вызовов, включает New pages, жмёт ▶. Статус пишет в очередь.
R=/Users/restart/Documents/GitHub/AutoOrchestr; cd "$R" || exit 1; Q=docs/TheCycle/ops/queue.json; T=$(mktemp -d)
ID=$(python3 -I - "$1" "$Q" <<'PY'
import json,sys
w,q=sys.argv[1:3];d=json.load(open(q))
for i in d['items']:
    if (w=='next' and i['status']=='queued') or (w=='auto' and i['status']=='queued' and i.get('autostart')) or i['id']==w: print(i['id']);break
PY
)
[[ -z "$ID" ]] && { echo "нет задания: $1"; exit 2; }
python3 -I - "$ID" "$Q" "$T" <<'PY'
import json,sys
i,q,t=sys.argv[1:4];d=json.load(open(q));it=[x for x in d['items'] if x['id']==i][0]
task=open(it['taskFile'],encoding='utf-8').read()
js="""(()=>{const it=[...document.querySelectorAll('.pipeline-item-name')].find(e=>e.innerText.trim()===%s);if(!it)return 'NO_PIPELINE';
(it.closest('.pipeline-item-main')||it).click();
const ta=document.querySelector('#modTa');ta.value=%s;['input','change'].forEach(n=>ta.dispatchEvent(new Event(n,{bubbles:true})));
const b=document.querySelector('#circle-call-budget');b.value='%d';['input','change'].forEach(n=>b.dispatchEvent(new Event(n,{bubbles:true})));
const np=document.querySelector('#new-pages-checkbox');if(np&&!np.checked)np.click();
const r=document.querySelector('#debate-run-toggle-btn');if(/Остановить/.test(r.title))return 'ALREADY_RUNNING';
r.click();return 'STARTED'})()"""%(json.dumps(it['pipeline'],ensure_ascii=False),json.dumps(task,ensure_ascii=False),it['maxCalls'])
open(t+'/go.js','w',encoding='utf-8').write(js)
PY
scripts/agent/tab-js.sh pipeline_panel "$T/go.js" > "$T/out" 2>&1
if ! grep -q "STARTED\|ALREADY" "$T/out"; then
  osascript -e 'tell application "Google Chrome" to open location "chrome-extension://egfijmjjpedpikkfmfaekjbhjjjlhlgo/pipeline_panel.html"'; sleep 8
  scripts/agent/tab-js.sh pipeline_panel "$T/go.js" > "$T/out" 2>&1
fi
R1=$(cat "$T/out"); echo "$(date '+%H:%M') $ID: $R1"
python3 -I - "$ID" "$Q" "$R1" <<'PY'
import json,sys
i,q,r=sys.argv[1:4];d=json.load(open(q))
for x in d['items']:
    if x['id']==i and ('STARTED' in r or 'ALREADY' in r): x['status']='running'
json.dump(d,open(q,'w'),ensure_ascii=False,indent=1)
PY
