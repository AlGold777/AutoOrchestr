#!/bin/bash
# bash split.sh <файл.md> <папка> [максимум символов в части, по умолчанию 12000]
# Режет файл по границам абзацев на части part_01.md, part_02.md ... Ничего не выбрасывает и не сокращает.
python3 - "$1" "$2" "${3:-12000}" <<'PY'
import sys,os
src,out,lim=sys.argv[1],sys.argv[2],int(sys.argv[3])
os.makedirs(out,exist_ok=True)
paras=open(src,encoding='utf-8').read().split('\n\n')
parts,cur=[],''
for p in paras:
    while len(p)>lim:
        if cur: parts.append(cur); cur=''
        parts.append(p[:lim]); p=p[lim:]
    if len(cur)+len(p)+2>lim and cur: parts.append(cur); cur=p
    else: cur=(cur+'\n\n'+p) if cur else p
if cur: parts.append(cur)
for i,t in enumerate(parts,1):
    open(os.path.join(out,'part_%02d.md'%i),'w',encoding='utf-8').write(t)
print(len(parts))
PY
