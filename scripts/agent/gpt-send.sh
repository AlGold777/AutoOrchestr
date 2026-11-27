#!/bin/zsh
# Отправляет текст из файла в чат ChatGPT и проверяет, что сообщение ушло.
# usage: gpt-send.sh <url-substring> <message-file>
# exit: 0 отправлено; 1 не ушло; 3 нет вкладки; 5 идёт генерация (не отправлять поверх).
set -u
[[ $# -eq 2 && -f $2 ]] || { echo "usage: gpt-send.sh <url-substring> <message-file>" >&2; exit 2; }
D=${0:A:h}; NEEDLE=$1; JS=$(mktemp -t gptsend).js
users() { "$D/tab-js.sh" "$NEEDLE" "$D/gpt-state.js" | python3 -I -c 'import json,sys;print(json.loads(sys.stdin.read())["users"])' 2>/dev/null; }
python3 -I - "$2" "$JS" <<'PY'
import json,sys
t=open(sys.argv[1],encoding='utf-8').read().strip()
js="""(()=>{const box=document.querySelector('#prompt-textarea')||document.querySelector('.ProseMirror[contenteditable="true"]');if(!box)return 'NO_COMPOSER';
if([...document.querySelectorAll('button')].find(b=>b.dataset.testid==='stop-button'||/^(Остановить|Stop)/.test(b.getAttribute('aria-label')||'')))return 'BUSY';
box.focus();document.execCommand('selectAll',false,null);document.execCommand('insertText',false,%s);
setTimeout(()=>{const b=document.querySelector('[data-testid="send-button"],#composer-submit-button,button[aria-label*="Отправ"],button[aria-label*="Send"]');if(b&&!b.disabled)b.click();},800);
return 'TYPED';})()"""%json.dumps(t)
open(sys.argv[2],'w',encoding='utf-8').write(js)
PY
before=$(users); [[ -z $before ]] && { echo "NO_TAB"; rm -f "$JS"; exit 3; }
r=$("$D/tab-js.sh" "$NEEDLE" "$JS"); rm -f "$JS"
case $r in BUSY) echo "BUSY"; exit 5;; NO_TAB) echo "NO_TAB"; exit 3;; TYPED) ;; *) echo "$r"; exit 1;; esac
for i in 1 2 3 4 5 6; do sleep 2; u=$(users); (( ${u:-0} > before )) && { echo "ОТПРАВЛЕНО"; exit 0; }; done
echo "НЕ УШЛО: текст в поле, кнопка не сработала"; exit 1
