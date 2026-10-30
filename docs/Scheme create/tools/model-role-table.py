#!/usr/bin/env python3 -I
"""Таблица «модель × роль» по экспортам Basic: docs/Run/Test_run/*/exports/*.json.
Запуск: python3 -I "docs/Scheme create/tools/model-role-table.py" [--md]
«Мусор» = ответ начинается со страницы-оболочки Perplexity («Новое / Компьютер…») или короче 500 символов.
Роль выводится из имени pipeline и ссылки шага (ref): см. ROLES."""
import glob, json, os, statistics, sys
from collections import Counter, defaultdict

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
# (признак имени pipeline) -> {ref шага: роль}
ROLES = {
    'Remote Viewfinder': {'r1': 'вариант', 'r2': 'свод', 'r3': 'аудит', 'r4': 'правка', 'r5': 'итог'},
    'Mosquito': {'r1': 'вариант (поиск)', 'r2': 'свод', 'r3': 'аудит+факты (поиск)', 'r4': 'итог'},
}

def role_of(pipeline, ref):
    for key, m in ROLES.items():
        if key in pipeline:
            return m.get(ref, ref)
    return ref

def load():
    seen, rows = set(), []
    for p in sorted(glob.glob(os.path.join(ROOT, 'docs/Run/Test_run/*/exports/*.json'))):
        d = json.load(open(p, encoding='utf-8'))
        cr = d.get('customRun') or {}
        name, texts = cr.get('pipelineName', ''), cr.get('texts', {})
        for a in cr.get('attempts', []):
            k = (cr.get('runId'), a.get('key'), a.get('attempt'))
            if k in seen:
                continue
            seen.add(k)
            txt = texts.get(a.get('answerRef') or '', '') or a.get('answer') or ''
            dur = (a['finishedAt'] - a['sentAt']) / 1000 if a.get('finishedAt') and a.get('sentAt') else None
            rows.append(dict(export=os.path.basename(p), ver=d.get('extensionVersion'), pipeline=name,
                             model=a.get('model'), role=role_of(name, a.get('ref')), ref=a.get('ref'),
                             attempt=a.get('attempt'), status=a.get('status') or ('state:' + str(a.get('state'))), accepted=bool(a.get('accepted')),
                             reason=a.get('reason') or '', n=len(txt), dur=dur,
                             junk=txt.startswith('Новое\nКомпьютер') or (0 < len(txt) < 500)))
    return rows

SOLO = {'свод', 'правка', 'итог'}  # раунды с одним участником: время раунда = время ответа

def solo_time(rs):
    t = [r['dur'] for r in rs if r['role'] in SOLO and r['dur'] and r['accepted']]
    return f'{int(statistics.median(t))}' if t else 'н/п'

def table(rows):
    g = defaultdict(list)
    for r in rows:
        g[(r['role'], r['model'])].append(r)
    out = []
    for (role, model), rs in sorted(g.items()):
        acc = [r for r in rs if r['accepted']]
        rej = Counter(r['status'] + ':' + (r['reason'] or '-') for r in rs if not r['accepted'])
        lens = [r['n'] for r in acc]
        out.append((role, model, len(rs), len(acc), ', '.join(f'{k}×{v}' for k, v in rej.most_common()) or '—',
                    f'{int(statistics.median(lens))}' if lens else '—',
                    f'{min(lens)}–{max(lens)}' if lens else '—',
                    sum(1 for r in rs if r['n'] == 0),
                    sum(1 for r in acc if r['junk']),
                    solo_time(rs)))
    return out

if __name__ == '__main__':
    rows = load()
    print(f'Попыток всего: {len(rows)}; экспортов: {len({r["export"] for r in rows})}')
    print('| Роль | Модель | Попыток | Принято | Отказы (статус:причина) | Длина принятых, медиана | Диапазон | Пустых | Принято, но мусор или <500 симв. | Время, с (соло-раунды) |')
    print('|---|---|---|---|---|---|---|---|---|---|')
    for t in table(rows):
        print('| ' + ' | '.join(map(str, t)) + ' |')
    if '--detail' in sys.argv:
        for r in rows:
            print(r)
