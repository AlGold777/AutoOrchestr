#!/usr/bin/env python3
"""Generate the four JS files that import a schema into pipeline_panel, name it, select it and set the task.
usage: python3 "docs/Run Automation/tools/make-import-scripts.py" <schema.json> <task.txt> "<pipeline name>" <out_dir>
Then run them in this order with js.sh: paste.js, name.js (clicks the name OK), select.js, task.js; then click the info window OK
(click-ok-modal.js) and press run (run-click.js). All JS strings are JSON-encoded, so any text is safe."""
import json,sys,os
schema,task,name,out=sys.argv[1:5]
os.makedirs(out,exist_ok=True)
s=open(schema,encoding='utf-8').read(); t=open(task,encoding='utf-8').read()
w=lambda f,c: open(os.path.join(out,f),'w',encoding='utf-8').write(c)
w('paste.js',"(function(){document.getElementById('pipeline-profile-btn').click();var t=document.getElementById('schema-paste-text');if(!t)return 'no window';t.value="+json.dumps(s)+";t.dispatchEvent(new Event('input',{bubbles:true}));document.getElementById('schema-paste-apply').click();return 'applied'})()")
w('name.js',"(function(){var i=[...document.querySelectorAll('input')].filter(e=>e.offsetParent&&e.type==='text'&&!e.id.startsWith('llm'));var inp=document.activeElement&&document.activeElement.tagName==='INPUT'?document.activeElement:i[i.length-1];if(!inp)return 'no input';inp.value="+json.dumps(name)+";inp.dispatchEvent(new Event('input',{bubbles:true}));var ok=[...document.querySelectorAll('button')].filter(b=>b.offsetParent&&/^(OK|ОК)$/.test(b.textContent.trim()))[0];if(!ok)return 'no ok';ok.click();return 'ok clicked'})()")
w('select.js',"(function(){var i=document.querySelector('.pipeline-item[data-name='+JSON.stringify("+json.dumps(name)+")+']');if(!i)return 'absent';(i.querySelector('.pipeline-item-name')||i).click();return 'selected'})()")
w('task.js',"var p=document.getElementById('modTa');p.value="+json.dumps(t)+";p.dispatchEvent(new Event('input',{bubbles:true}));'task set '+p.value.length")
w('run-click.js',"(function(){var b=document.getElementById('debate-run-toggle-btn');b.click();return 'run clicked: '+b.textContent.trim()})()")
print('written to',out)
