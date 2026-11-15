#!/usr/bin/env python3
"""Driver of the camera-remote consensus runs on the experiment copy of the extension.
usage: python3 -I drive.py install | start | verdicts <id> | nextpass [<файл замечаний ведущего>] | watch [seconds] | owner <decision file> | cycle [seconds] | finish | status | synth claude|gpt
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
INTRO = ('Задача: на целевом телефоне должно снимать ШТАТНОЕ приложение Камера (не наше приложение с камерой, не системный camera-UI вроде '
         'UIImagePickerController, не стороннее приложение по интенту), а команда на съёмку должна прийти извне — от обычного приложения на управляющем телефоне. '
         'Нужно получить именно снимок конвейером штатной камеры (HDR, Deep Fusion, режимы), а не просто фото. '
         'Принятые условия: целевой телефон — iPhone с актуальной iOS 26; управляющий — iPhone или Android; без jailbreak, root и дополнительного оборудования, только телефоны; '
         'каналы: Bluetooth, Wi-Fi или интернет; допустим вспомогательный компонент на целевом телефоне, если он не реализует камеру, а лишь запускает или оркестрирует штатную; '
         'достаточно команды спуска и возврата снятого файла. Критерий успеха: на целевом в foreground штатная Камера, команда пришла извне, файл снят её конвейером. '
         'Разбирай только техническую сторону и только то, что разрешено платформой. Если рабочего пути нет, назови, какие именно механизмы iOS это запрещают и какие минимальные ослабления открывают путь. '
         'Ссылайся на версию iOS и источник; не выдумывай API.\n\n')
os.makedirs(TMP, exist_ok=True)


KINDS = {'explore': ('Camera-Explore', 'camera-explore.schema.json'), 'agree': ('Camera-Agree', 'camera-agree.schema.json')}


def variant(kind='explore'):
    name, file = KINDS[kind]
    return name, os.path.join(RUN, 'schema', file)


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


def import_schema(name, schema):
    task = os.path.join(TMP, 'task.txt')
    open(task, 'w', encoding='utf8').write('задача')
    subprocess.run(['python3', '-I', os.path.join(TOOLS, 'make-import-scripts.py'), schema, task, name, TMP], check=True)
    for step in ('paste.js', 'name.js'):
        print(name, step, js_file(os.path.join(TMP, step)))
        time.sleep(2)
    if 'уже есть' in tool('any-modal.js'):
        print('replace', click('Заменить'))
        time.sleep(2)
    print('ok', tool('click-ok-modal.js'))
    time.sleep(1)
    print('close', tool('close-choice-dialog.js'))
    time.sleep(1)
    print('select', js_file(os.path.join(TMP, 'select.js')))
    time.sleep(1)
    print('modal', tool('any-modal.js'))


def install():
    ensure_panel()
    for kind in KINDS:
        name, schema = variant(kind)
        import_schema(name, schema)


def start():
    state = load()
    if screen_locked():
        print('SCREEN_LOCKED')
        return
    if state.get('current'):
        print('ALREADY', state['current'])
        return
    rest = [q for q in questions() if q['id'] not in state['done'] and q['id'] not in state['blocked']]
    if not rest:
        print('ALL_DONE')
        return
    item = rest[0]
    ensure_panel()
    import hashlib
    digest = hashlib.sha1(b''.join(open(variant(k)[1], 'rb').read() for k in KINDS)).hexdigest()
    if state.get('schemaHash') != digest:
        print('schemas changed: install', flush=True)
        install()
        state = load()
        state['schemaHash'] = digest
        save(state)
    name, schema = variant(item.get('kind', 'explore'))
    if item.get('file'):
        # The current solution and the lead's notes go as an attached file (step r1 `files`): the request stays short and nothing is cut.
        doc = json.load(open(schema, encoding='utf8'))
        body = item['file']['content']
        for step in doc['steps']:
            if load().get('judge') == 'deepseek':
                # The daily limit of Qwen4-Max-Preview: its page answers with the limit text, which must not enter the synthesis as an opinion.
                if step['ref'] == 'r1':
                    step['models'] = [m for m in step['models'] if m.get('id') != 'qwen-a']
                if isinstance(step.get('input'), list):
                    step['input'] = [i for i in step['input'] if not (isinstance(i, dict) and i.get('participant') == 'qwen-a')]
            if step['ref'] == 'r3' and load().get('judge') == 'deepseek':
                # Qwen4-Max-Preview reached its daily limit: DeepSeek judges until it is over (`judge` in state.json).
                step['models'] = [{'name': 'DeepSeek', 'id': 'deepseek-rev', 'label': 'DeepSeek · Судья (вместо Qwen: дневной лимит)', 'role': 'interaction_critical_audit', 'maxWords': 900}]
            if step['ref'] == 'r1':
                step['files'] = [{'id': item['file']['id'], 'name': item['file']['name'], 'type': 'text/markdown', 'size': len(body.encode('utf8')), 'content': body}]
        schema = os.path.join(TMP, 'attached.schema.json')
        json.dump(doc, open(schema, 'w', encoding='utf8'), ensure_ascii=False)
        import_schema(name, schema)
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
    # Every question goes to new chats: the checkbox turns itself off after a run, and without it the models continue old chats.
    fresh = js("""(function(){var c=document.getElementById('new-pages-checkbox');if(!c)return 'no checkbox';if(!c.checked)c.click();return c.checked?'on':'off'})()""")
    print('new chats', fresh)
    if fresh != 'on':
        print('NEW_CHATS_NOT_ON', flush=True)
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


def qwen_wait(modal, match):
    """One run only (state qwenWait): Qwen gets 15 minutes from the start of the run before it is skipped, then one retry, which rereads its page first."""
    state = load()
    cur = state.get('current') or {}
    if state.get('qwenWait') != cur.get('id') or not match or 'qwen' not in match[1] or re.search(r'gpt|claude|deepseek|perplexity', match[1], re.I):
        return False
    if time.time() - cur.get('startedAt', 0) < 15 * 60:
        time.sleep(20)
        return True
    if not cur.get('qwenRetried'):
        cur['qwenRetried'] = True
        save(state)
        print('qwen: 15 минут прошло, повтор', click('Повторить'), flush=True)
        time.sleep(5)
        return True
    return False


PATIENCE_MAX = 90 * 60  # the longest a single participant is waited for while its page still shows generation
HOST_OF = {'gpt': 'chatgpt.com', 'claude': 'claude.ai', 'deepseek': 'chat.deepseek.com', 'qwen': 'chat.qwen.ai', 'perplexity': 'perplexity.ai'}


def generating(name):
    """True while the participant's page still writes the answer (Stop button, thinking line, spinner or text that keeps growing). Patience: the run never gives up on a page that is working."""
    host = next((h for k, h in HOST_OF.items() if k in (name or '').lower()), None)
    if not host:
        return False
    def read():
        out = subprocess.run(['bash', os.path.join(TOOLS, 'js.sh'), os.path.join(HERE, 'gen-state.js'), host], capture_output=True, text=True, timeout=60).stdout.strip()
        try:
            return json.loads(out)
        except ValueError:
            return None
    first = read()
    if not first:
        return False
    if first.get('stop') or first.get('thinking') or first.get('spinner'):
        return True
    time.sleep(25)
    second = read()
    return bool(second and (second.get('stop') or second.get('thinking') or second.get('spinner') or second.get('len', 0) > first.get('len', 0) + 20))


def patient(who):
    """Waits while the participant named in the 'без ответа' window is still generating. Returns True when the caller must keep waiting."""
    state = load()
    cur = state.get('current') or {}
    who = (who or '').strip()
    if not who or not generating(who):
        return False
    waited = cur.setdefault('patience', {})
    start = waited.setdefault(who, int(time.time()))
    save(state)
    if time.time() - start > PATIENCE_MAX:
        print('patience: %s пишет уже больше 90 минут, дальше по правилам' % who, flush=True)
        return False
    print('patience: %s ещё пишет ответ, жду' % who, flush=True)
    return True


_UNSENT_SINCE = {}


def fix_unsent():
    """ChatGPT: the app pastes a long request but does not press Send (seen 2026-11-15: the request stays in the composer, the chat has no turn).
    A request that lies unsent in the composer for 45 s with no generation is sent by pressing the same Send button a person would press."""
    host = HOST_OF['gpt']
    try:
        out = subprocess.run(['bash', os.path.join(TOOLS, 'js.sh'), os.path.join(HERE, 'unsent.js'), host], capture_output=True, text=True, timeout=60).stdout.strip()
        info = json.loads(out)
    except Exception:
        return False
    if not info.get('unsent'):
        _UNSENT_SINCE.pop(host, None)
        return False
    since = _UNSENT_SINCE.setdefault(host, time.time())
    if time.time() - since < 45:
        return False
    sent = subprocess.run(['bash', os.path.join(TOOLS, 'js.sh'), os.path.join(HERE, 'unsent-send.js'), host], capture_output=True, text=True, timeout=60).stdout.strip()
    print('unsent request in the ChatGPT composer for %d s: send -> %s' % (int(time.time() - since), sent), flush=True)
    state = load()
    state.setdefault('manualSends', []).append({'id': (state.get('current') or {}).get('id'), 'at': int(time.time()), 'len': info.get('len')})
    save(state)
    _UNSENT_SINCE.pop(host, None)
    return True


def screen_locked():
    """A locked screen hides every tab (visibilityState hidden): requests are not taken by the pages, and the data of the stretch is invalid."""
    out = subprocess.run('ioreg -n Root -d1 -a 2>/dev/null | grep -A1 CGSSessionScreenIsLocked', shell=True, capture_output=True, text=True).stdout
    return '<true/>' in out


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
        if screen_locked():
            print(json.dumps({'event': 'screen_locked'}), flush=True)
            return 'screen_locked'
        fix_unsent()
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
        if 'execution error' in modal or 'NO TAB' in modal:
            time.sleep(10)
            continue
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
            if qwen_wait(modal, match):
                continue
            pm = re.search(r'без ответа: ([^.?]*)|нет принятых ответов \(([^()]*)', modal)
            if pm and patient(pm.group(1) or pm.group(2)):
                time.sleep(60)
                beat()
                continue
            if 'Пропустить участника' in modal and match and not re.search(r'gpt|claude|qwen-rev|deepseek-rev', match[1], re.I):
                print('auto skip:', match[1], click('Пропустить участника'), flush=True)
                state = load()
                state.setdefault('skips', []).append({'id': (state.get('current') or {}).get('id'), 'who': match[1]})
                save(state)
                time.sleep(5)
                continue
            needs_retry = 'нет принятых ответов' in modal or (match and re.search(r'gpt|claude|qwen-rev|deepseek-rev', match[1], re.I))
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
    first = {}
    for a in run.get('attempts', []):
        if a.get('phase') == 'answer':
            first.setdefault((a['ref'], a['participant']), (a.get('chatRoute') or {}).get('action'))
    old = sorted(f'{r}/{p}' for (r, p), action in first.items() if r == 'r1' and action != 'created')
    print('old chats in r1:', old, flush=True)
    state.setdefault('chatCheck', {})[cur['id']] = old
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


VERDICT = re.compile(r'вердикт\s*[:\-—]\s*(не согласен|согласен с правками|согласен)', re.I)


def answers_of(qid):
    data = json.load(open(os.path.join(RUN, 'exports', qid + '.json'), encoding='utf8'))
    run = data['customRun']
    texts = run.get('texts', {})
    out = {}
    for a in run.get('attempts', []):
        if a.get('accepted') and a.get('phase') == 'answer':
            out[(a['ref'], a['participant'])] = texts.get(a.get('answerRef')) or a.get('answer') or ''
    return out


def verdicts(qid):
    """Consensus of an agreement pass: no 'не согласен' among the first-round models, GPT and DeepSeek agree, at least three verdicts, reviewer accepts."""
    ans = answers_of(qid)
    seen = {}
    for (ref, who), text in ans.items():
        if ref == 'r1':
            found = VERDICT.findall(text[-600:])
            seen[who] = found[-1].lower() if found else 'нет строки'
    review = next((t for (ref, who), t in ans.items() if ref == 'r3'), '')
    tail = review[-700:].lower()
    accepted = ('можно принимать' in tail or 'принимать решение' in tail) and 'вернуть на доработку' not in tail.split('можно принимать')[-1][:200]
    agree = [k for k, v in seen.items() if v in ('согласен', 'согласен с правками')]
    against = [k for k, v in seen.items() if v == 'не согласен']
    ok = len(agree) >= 3 and not against and any(k.startswith('gpt') for k in agree) and any(k.startswith('deepseek') for k in agree) and accepted
    print(json.dumps({'id': qid, 'verdicts': seen, 'reviewerAccepts': accepted, 'result': 'CONSENSUS' if ok else 'NO_CONSENSUS'}, ensure_ascii=False))
    return ok


def nextpass(notes_path=None):
    """Appends the next agreement pass: the current solution (final of the last finished pass) plus the lead's review go into the task text."""
    state = load()
    qs = questions()
    last = state['done'][-1] if state['done'] else None
    if not last:
        print('NO_DONE')
        return
    if len(qs) >= 8:
        print('MAX_PASSES')
        return
    ans = answers_of(last)
    final = next((t for (ref, who), t in ans.items() if ref == 'r4'), '')
    if not final:
        print('NO_FINAL')
        return
    n = len(qs) + 1
    body = 'ТЕКУЩЕЕ РЕШЕНИЕ (проход %d)\n\n%s' % (len(qs), final)
    if notes_path and os.path.exists(notes_path):
        body += '\n\n=====\nЗАМЕЧАНИЯ ВЕДУЩЕГО ПО ПРОШЛОМУ ПРОХОДУ (ответь по каждому пункту отдельно: подтверждаешь по документации платформы, опровергаешь или не знаешь)\n\n' + open(notes_path, encoding='utf8').read().strip()
    text = ('Дай оценку текущего решения из приложенного файла (в нём же замечания ведущего: ответь на каждое отдельно). '
            'Вопрос исходной задачи: как внешней командой заставить штатное приложение Камера целевого iPhone сделать снимок своим конвейером.')
    qs.append({'id': 'c%02d' % n, 'name': 'Согласование, проход %d' % n, 'kind': 'agree', 'q': text,
               'file': {'id': 'solution-%d' % n, 'name': 'Решение и замечания ведущего (проход %d).md' % n, 'content': body}})
    json.dump(qs, open(os.path.join(RUN, 'notes', 'questions.json'), 'w', encoding='utf8'), ensure_ascii=False, indent=1)
    print('QUEUED', 'c%02d' % n)


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
elif cmd == 'verdicts':
    verdicts(sys.argv[2])
elif cmd == 'nextpass':
    nextpass(sys.argv[2] if len(sys.argv) > 2 else None)
elif cmd == 'status':
    print(json.dumps({k: v for k, v in load().items() if k != 'hints'}, ensure_ascii=False))
    print(tool('run-state.js'))
    print(tool('any-modal.js'))
