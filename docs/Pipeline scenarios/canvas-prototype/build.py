#!/usr/bin/env python3
"""Собирает единый canvas-prototype-vN.html (N — STAND_VERSION из stand.js; старые сборки удаляются) из index.html, скриптов и настоящих стилей проекта.
Запуск из любого места: python3 build.py"""
import base64, json, os, re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
rd = lambda p: open(p, encoding='utf-8').read()


def css(path):
    text, base = rd(path), os.path.dirname(path)

    def imp(m):
        url = m.group(1).split('?')[0]
        return m.group(0) if url.startswith('http') else css(os.path.join(base, url))

    return re.sub(r'@import url\("([^"]+)"\);', imp, text)


main = css(os.path.join(ROOT, 'styles.css')) + '\n' + rd(os.path.join(ROOT, 'styles/pipeline-card-cover.css'))
imports = re.findall(r'@import url\("https?://[^"]+"\);', main)
main = re.sub(r'@import url\("https?://[^"]+"\);\n?', '', main)
css_all = '\n'.join(imports) + '\n' + main

icons = {}
icon_dir = os.path.join(ROOT, 'icons/models')
for name in os.listdir(icon_dir):
    if name.endswith('.svg'):
        icons[name[:-4]] = 'data:image/svg+xml;base64,' + base64.b64encode(open(os.path.join(icon_dir, name), 'rb').read()).decode()

html = rd(os.path.join(HERE, 'index.html'))
html = re.sub(r'\s*<link rel="stylesheet" href="\.\./\.\./\.\./[^"]+">', '', html)
html = re.sub(r'src="\.\./\.\./\.\./icons/models/([a-z_]+)\.svg"', lambda m: 'src="' + icons[m.group(1)] + '"', html)

cards = rd(os.path.join(HERE, 'cards.js'))
cards = cards.replace(
    "const projectUrl = (path) => new URL(`../../../${path}`, base).href;",
    "const projectUrl = (path) => { const m = /icons\\/models\\/([a-z_]+)\\.svg/.exec(path); return m ? (window.__PROTO_ICONS__[m[1]] || '') : path; };")

parts = ['window.__PROTO_ICONS__=' + json.dumps(icons) + ';',
         rd(os.path.join(HERE, 'state.js')),
         rd(os.path.join(ROOT, 'results/stage-card.js')),
         cards,
         rd(os.path.join(HERE, 'canvas.js'))]
stand = os.path.join(HERE, 'stand.js')
if os.path.exists(stand):
    parts.append(rd(stand))
banner = '''window.addEventListener('error', function (e) {
  var bar = document.getElementById('proto-error-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'proto-error-bar';
    bar.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#dc2626;color:#fff;padding:8px 14px;font:13px system-ui,sans-serif;white-space:pre-wrap';
    document.body ? document.body.appendChild(bar) : document.documentElement.appendChild(bar);
  }
  bar.textContent += 'Ошибка загрузки: ' + (e.message || e.error) + (e.lineno ? ' (строка ' + e.lineno + ')' : '') + '\\n';
});'''
scripts = ''.join('<script>\n' + s.replace('</script', '<\\/script') + '\n</script>\n' for s in [banner] + parts)

html = re.sub(r'<script src="[^"]+"></script>\s*', '', html)
html = html.replace('</head>', '<style>\n' + css_all + '\n</style>\n</head>', 1)
html = html.replace('</body>', scripts + '</body>', 1)
version = re.search(r"STAND_VERSION = '(\d+)'", rd(stand)).group(1) if os.path.exists(stand) else '0'
out = 'canvas-prototype-v%s.html' % version
for name in os.listdir(HERE):
    if re.fullmatch(r'canvas-prototype(-v\d+)?\.html', name) and name != out:
        os.remove(os.path.join(HERE, name))
open(os.path.join(HERE, out), 'w', encoding='utf-8').write(html)
print(out, len(html), 'bytes')
