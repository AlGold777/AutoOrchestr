#!/usr/bin/env python3
"""Driver of the 3D avatar runs on the experiment copy of the extension.
usage: python3 -I avatar.py install | start | watch [seconds] | owner <decision file> | cycle [seconds] | finish | status | synth claude|gpt
All state is in notes/state.json of the run folder."""
import glob, json, os, re, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(sys.argv[0]))
RUN = os.path.dirname(HERE)
ROOT = os.path.abspath(os.path.join(RUN, '..', '..', '..', '..'))
TOOLS = os.path.join(ROOT, 'docs', 'Run Automation', 'tools')
TMP = os.path.join(HERE, 'tmp')
EXT = 'dpnajmofhnhhikfbefjbhlbfidejcnkk'
PANEL = EXT + '/pipeline_panel'
STATE = os.path.join(RUN, 'notes', 'state.json')
HEART = os.path.join(RUN, 'notes', 'heartbeat')
INTRO = ('Продукт: мобильное приложение для iOS и Android, которое по съёмке телефоном создаёт реалистичный 3D-аватар '
         'пользователя: похож на человека, анимируется и показывается в реальном времени. Нужен практичный ответ для команды, '
         'которая будет это строить. Разбирай только техническую сторону: вопросы права, лицензий, приватности и бизнеса сейчас не рассматривай.\n\nВопрос: ')
os.makedirs(TMP, exist_ok=True)


def variant():
    gpt = load().get('synth') == 'gpt'
    return ('Avatar3D-GPT' if gpt else 'Avatar3D'), os.path.join(RUN, 'schema', 'avatar-question-gpt-synth.schema.json' if gpt else 'avatar-question.schema.json')


HOSTS = ('chatgpt.com', 'claude.ai', 'chat.deepseek.com', 'chat.qwen.ai', 'perplexity.ai')


def model_tabs():
    script = 'set out to ""\ntell application "Google Chrome"\n repeat with w in windows\n  repeat with t in tabs of w\n   set out to out & (id of t) & " " & (URL of t) & linefeed\n  end repeat\n end repeat\nend tell\nreturn out'
    lines = subprocess.run(['osascript', '-e', script], capture_output=True, text=True).stdout.splitlines()
    return [l.split(' ', 1)[0] for l in lines if ' ' in l and any(h in l.split(' ', 1)[1] for h in HOSTS)]


def close_new_tabs(keep):
    """Close only the model tabs the finished run opened: tabs that existed before it stay."""
    extra = [i for i in model_tabs() if i not in keep]
    for tab in extra:
        subprocess.run(['osascript', '-e', f'tell application "Google Chrome" to repeat with w in windows\nclose (tabs of w whose id is {tab})\nend repeat'], capture_output=True)
    return len(extra)


def load():
    return json.load(open(STATE, encoding='utf8'))


def save(state):
    json.dump(state, open(STATE, 'w', encoding='utf8'), ensure_ascii=False, indent=1)


def questions():
    return json.load(open(os.path.join(RUN, 'notes', 'questions.json'), encoding='utf8'))


def beat():
    open(HEART, 'w').write(str(int(time.time())))


def js_file(path):
    out = subprocess.run(['bash', os.path.join(TOOLS, 'js.sh'), path, PANEL], capture_output=True, text=True, timeout=60)
    return out.stdout.strip() or out.stderr.strip()


def js(code):
    path = os.path.join(TMP, 'inline.js')
    open(path, 'w', encoding='utf8').write(code)
    return js_file(path)


def tool(name):
    return js_file(os.path.join(TOOLS, name))


def ensure_panel():
    if 'NO TAB' in tool('extension-version.js'):
        subprocess.run(['open', '-a', 'Google Chrome', f'chrome-extension://{EXT}/pipeline_panel.html'])
        time.sleep(5)


def install():
    ensure_panel()
    name, schema = variant()
    task = os.path.join(TMP, 'task.txt')
    open(task, 'w', encoding='utf8').write('задача')
    subprocess.run(['python3', '-I', os.path.join(TOOLS, 'make-import-scripts.py'), schema, task, name, TMP], check=True)
    for step in ('paste.js', 'name.js'):
        print(step, js_file(os.path.join(TMP, step)))
        time.sleep(2)
    print('ok', tool('click-ok-modal.js'))
    time.sleep(1)
    print('close', tool('close-choice-dialog.js'))
    time.sleep(1)
    print('select', js_file(os.path.join(TMP, 'select.js')))
    time.sleep(1)
    print('modal', tool('any-modal.js'))


def start():
    state = load()
    if state.get('current'):
        print('ALREADY', state['current'])
        return
    rest = [q for q in questions() if q['id'] not in state['done'] and q['id'] not in state['blocked']]
    if not rest:
        print('ALL_DONE')
        return
    item = rest[0]
    ensure_panel()
    name, schema = variant()
    task = os.path.join(TMP, 'task.txt')
    open(task, 'w', encoding='utf8').write(INTRO + item['q'])
    subprocess.run(['python3', '-I', os.path.join(TOOLS, 'make-import-scripts.py'), schema, task, name, TMP], check=True, capture_output=True)
    print('select', js_file(os.path.join(TMP, 'select.js')))
    time.sleep(1)
    print('task', js_file(os.path.join(TMP, 'task.js')))
    time.sleep(1)
    modal = tool('any-modal.js')
    if modal != '[]':
        print('MODAL_BEFORE_RUN', modal)
        return
    before = model_tabs()
    print('run', js_file(os.path.join(TMP, 'run-click.js')))
    state['current'] = {'id': item['id'], 'startedAt': int(time.time()), 'tabsBefore': before}
    save(state)
    beat()


DIALOG = """(function(){var d=document.querySelector('.choice-dialog');if(!d)return 'null';var m=d.querySelector('.choice-dialog-message');var h=d.querySelector('.choice-dialog-hint');return JSON.stringify({title:(d.querySelector('.choice-dialog-title')||{}).innerText||'',message:m?m.innerText:'',hint:h?h.innerText:null,buttons:[...d.querySelectorAll('button')].map(function(b){return b.textContent.trim()})})})()"""


def qwen_pick():
    """Qwen sometimes shows two answers and waits for a choice: the first answer is chosen (owner's rule)."""
    script = 'set js to (do shell script "cat " & quoted form of "%s")\nset out to ""\ntell application "Google Chrome"\n repeat with w in windows\n  repeat with t in tabs of w\n   if URL of t contains "chat.qwen.ai" then set out to out & (execute t javascript js) & ","\n  end repeat\n end repeat\nend tell\nreturn out' % os.path.join(HERE, 'qwen-pick-first.js')
    out = subprocess.run(['osascript', '-e', script], capture_output=True, text=True).stdout
    if 'picked' in out:
        print('qwen: выбран ответ 1', flush=True)
        state = load()
        state.setdefault('qwenPicks', []).append((state.get('current') or {}).get('id'))
        save(state)


def reachable():
    out = tool('extension-version.js')
    return bool(out) and 'NO TAB' not in out and 'execution error' not in out


def click(label):
    return js("""(function(){var b=[...document.querySelectorAll('button')].filter(function(x){return x.offsetParent&&x.textContent.trim()===%s})[0];if(!b)return 'no button';b.click();return 'clicked'})()""" % json.dumps(label, ensure_ascii=False))


def watch(limit):
    end = time.time() + limit
    idle = 0
    while time.time() < end:
        beat()
        # Chrome answers scripts for the profile in front: with an incognito window in front the panel cannot be seen for a while.
        if not reachable():
            time.sleep(20)
            continue
        qwen_pick()
        raw = js(DIALOG)
        dialog = json.loads(raw) if raw.startswith('{') else None
        if dialog and dialog['title'].startswith('Ответ User'):
            waited = time.time()
            while dialog['hint'] is None and time.time() - waited < 150:
                time.sleep(5)
                beat()
                raw = js(DIALOG)
                if not raw.startswith('{'):
                    break
                dialog = json.loads(raw)
            dialog['hintWaitSec'] = round(time.time() - waited)
            path = os.path.join(TMP, 'owner.json')
            json.dump(dialog, open(path, 'w', encoding='utf8'), ensure_ascii=False, indent=1)
            print(json.dumps({'event': 'owner', 'file': path, 'hint': dialog['hint'], 'hintWaitSec': dialog['hintWaitSec'], 'chars': len(dialog['message'])}, ensure_ascii=False), flush=True)
            return 'owner'
        modal = tool('any-modal.js')
        # The telemetry window is the owner's own: an open one does not stop the series.
        try:
            items = [m for m in json.loads(modal or '[]') if 'Telemetry' not in ' '.join(m.get('btns', []))]
            modal = json.dumps(items, ensure_ascii=False) if items else '[]'
        except ValueError:
            pass
        if modal not in ('[]', ''):
            if 'все шаги пройдены' in modal:
                print('ok', click('OK'))
                print(json.dumps({'event': 'ended', 'reason': 'steps_done'}, ensure_ascii=False), flush=True)
                return 'ended'
            match = re.search(r'без ответа: ([^.?]*)', modal)
            if 'Пропустить участника' in modal and match and not re.search(r'gpt|claude', match[1], re.I):
                print('auto skip:', match[1], click('Пропустить участника'), flush=True)
                state = load()
                state.setdefault('skips', []).append({'id': (state.get('current') or {}).get('id'), 'who': match[1]})
                save(state)
                time.sleep(5)
                continue
            needs_retry = 'нет принятых ответов' in modal or (match and re.search(r'gpt|claude', match[1], re.I))
            if needs_retry and 'Повторить' in modal and 'лимит' not in modal:
                state = load()
                cur = state.get('current') or {}
                if cur and cur.get('retries', 0) < 2:
                    cur['retries'] = cur.get('retries', 0) + 1
                    save(state)
                    # The page may still be writing the answer: give it time before a new request goes to the same chat.
                    for _ in range(9):
                        time.sleep(10)
                        beat()
                    print('auto retry', cur['retries'], click('Повторить'), flush=True)
                    time.sleep(5)
                    continue
            print(json.dumps({'event': 'modal', 'modal': modal, 'dialog': dialog}, ensure_ascii=False)[:2500], flush=True)
            return 'modal'
        run = json.loads(tool('run-state.js') or '{}')
        idle = 0 if 'Остановить' in str(run.get('runBtn')) else idle + 1
        if idle >= 3:
            print(json.dumps({'event': 'ended', 'run': run}, ensure_ascii=False), flush=True)
            return 'ended'
        time.sleep(20)
    print(json.dumps({'event': 'timeout', 'cards': tool('model-cards.js')[:1800]}, ensure_ascii=False), flush=True)
    return 'timeout'


def owner(path):
    text = open(path, encoding='utf8').read().strip()
    state = load()
    data = json.load(open(os.path.join(TMP, 'owner.json'), encoding='utf8'))
    state.setdefault('hints', []).append({'id': (state.get('current') or {}).get('id'), 'hint': data.get('hint'), 'hintWaitSec': data.get('hintWaitSec'), 'decision': text})
    save(state)
    out = js("""(function(){var d=document.querySelector('.choice-dialog');if(!d)return 'no dialog';var a=d.querySelector('textarea');if(!a)return 'no field';a.value=%s;a.dispatchEvent(new Event('input',{bubbles:true}));var b=d.querySelector('.choice-dialog-choice');if(!b||b.disabled)return 'no button';b.click();return 'sent'})()""" % json.dumps(text, ensure_ascii=False))
    print(out)
    beat()


def finish():
    state = load()
    cur = state.get('current')
    if not cur:
        print('NO_CURRENT')
        return
    before = set(glob.glob(os.path.expanduser('~/Downloads/Basic*.json')))
    print(js("""(function(){var t=document.getElementById('telemetry-toggle-btn');if(t)t.click();return 'open'})()"""))
    time.sleep(2)
    print(js("""(function(){var b=document.getElementById('disput-basic');if(!b)return 'no button';b.click();return 'export'})()"""))
    new = []
    for _ in range(30):
        time.sleep(2)
        new = [f for f in set(glob.glob(os.path.expanduser('~/Downloads/Basic*.json'))) - before if not f.endswith('.crdownload')]
        if new:
            break
    time.sleep(1)
    print(tool('close-devtools-modal.js'))
    if not new:
        print('NO_EXPORT')
        return
    target = os.path.join(RUN, 'exports', cur['id'] + '.json')
    os.replace(new[0], target)
    data = json.load(open(target, encoding='utf8'))
    run = data['customRun']
    texts = run.get('texts', {})
    saved = []
    for a in run.get('attempts', []):
        if a.get('accepted') and a.get('phase') == 'answer':
            text = texts.get(a.get('answerRef')) or a.get('answer') or ''
            name = f"{cur['id']}_{a['ref'].replace(':', '-')}_{a['participant']}.md"
            open(os.path.join(RUN, 'artefacts', name), 'w', encoding='utf8').write(text)
            saved.append(f"{a['ref']}/{a['participant']}:{len(text)}")
    final = [s for s in saved if s.startswith('r4/')]
    stop = run.get('stopReason')
    print(json.dumps({'id': cur['id'], 'stop': stop, 'answers': saved}, ensure_ascii=False))
    if final:
        state['done'].append(cur['id'])
    else:
        state['blocked'][cur['id']] = str(stop)
    print('closed tabs', close_new_tabs(cur.get('tabsBefore', model_tabs())))
    state['current'] = None
    save(state)
    beat()


def reload_if_asked():
    """A new version of the copy is loaded only between questions."""
    flag = os.path.join(TMP, 'reload-next')
    if not os.path.exists(flag):
        return
    os.remove(flag)
    print('reload', subprocess.run(['bash', os.path.join(TOOLS, 'js.sh'), os.path.join(HERE, 'reload-copy.js'), 'chrome://extensions'], capture_output=True, text=True).stdout.strip(), flush=True)
    time.sleep(6)
    ensure_panel()
    print(subprocess.run(['osascript', os.path.join(TOOLS, 'refresh-model-tabs.applescript')], capture_output=True, text=True).stdout.strip(), flush=True)
    time.sleep(8)


def restore_synth():
    """After the usage limit of Claude has passed, Claude writes the synthesis again."""
    state = load()
    if state.get('synth') == 'gpt' and state.get('synthUntil') and time.time() > state['synthUntil']:
        state['synth'] = 'claude'
        state.pop('synthUntil', None)
        save(state)
        print('synth: снова Claude', flush=True)


def abort():
    """Stops the run on its decision window; the question stays in the queue and runs again."""
    print(click('Остановить прогон'), flush=True)
    time.sleep(4)
    print(tool('click-ok-modal.js'), flush=True)
    state = load()
    state['current'] = None
    save(state)


def cycle(limit):
    """Runs question after question; comes back only for what needs the lead: a decision, a window, a long silence, the end."""
    while True:
        event = watch(limit)
        if event != 'ended':
            return
        finish()
        state = load()
        if state.get('current'):
            print('FINISH_FAILED', flush=True)
            return
        reload_if_asked()
        restore_synth()
        time.sleep(8)
        start()
        state = load()
        if not state.get('current'):
            print('NO_NEXT_RUN', flush=True)
            return
        time.sleep(10)


cmd = sys.argv[1]
if cmd == 'install':
    install()
elif cmd == 'start':
    start()
elif cmd == 'watch':
    watch(int(sys.argv[2]) if len(sys.argv) > 2 else 1500)
elif cmd == 'cycle':
    cycle(int(sys.argv[2]) if len(sys.argv) > 2 else 1500)
elif cmd == 'owner':
    owner(sys.argv[2])
elif cmd == 'finish':
    finish()
elif cmd == 'abort':
    abort()
elif cmd == 'reload':
    reload_if_asked()
elif cmd == 'synth':
    state = load()
    state['synth'] = sys.argv[2]
    if len(sys.argv) > 3:
        state['synthUntil'] = int(sys.argv[3])
    save(state)
    install()
elif cmd == 'status':
    print(json.dumps({k: v for k, v in load().items() if k != 'hints'}, ensure_ascii=False))
    print(tool('run-state.js'))
    print(tool('any-modal.js'))
