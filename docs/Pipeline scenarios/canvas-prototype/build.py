#!/usr/bin/env python3
"""Собирает единый canvas-prototype.html из index.html, скриптов и настоящих стилей проекта.
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
js = '\n'.join(parts).replace('</script', '<\\/script')

html = re.sub(r'<script src="[^"]+"></script>\s*', '', html)
html = html.replace('</head>', '<style>\n' + css_all + '\n</style>\n</head>', 1)
html = html.replace('</body>', '<script>\n' + js + '\n</script>\n</body>', 1)
open(os.path.join(HERE, 'canvas-prototype.html'), 'w', encoding='utf-8').write(html)
print('canvas-prototype.html', len(html), 'bytes')
