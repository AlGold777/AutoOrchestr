# usage: python3 -I myscore.py answer.json   (reference computed by full enumeration in score_ref())
import json,sys
from itertools import combinations, product
import os
TASK2=os.environ.get('TASK')=='2'
w={1:9,2:7,3:6,4:5,5:8,6:4,7:10,8:3,9:6,10:7,11:5,12:8,13:4,14:9,15:3,16:6}
P={'A':(4,[1,2,6,9]),'B':(5,[2,3,7,11]),'C':(3,[1,4,8,13]),'D':(6,[5,7,10,14]),'E':(4,[3,5,9,15]),'F':(3,[4,6,12,16]),'G':(5,[2,8,10,12]),'H':(4,[7,11,13,16]),'I':(6,[1,5,12,14]),'J':(3,[3,6,10,15]),'K':(4,[4,9,11,14]),'L':(5,[5,8,13,16])}
cov=lambda s:set().union(*[P[p][1] for p in s]) if s else set()
val=lambda s:sum(w[e] for e in cov(s)); cost=lambda s:sum(P[p][0] for p in s)
def ok(s):
    S=set(s); return cost(s)<=20 and not {'A','D'}<=S and not {'F','K'}<=S and ('I' not in S or 'C' in S) and bool(S&{'B','H'}) and bool(S&{'E','J'})
if TASK2:
    w=dict(zip(range(1,21),[9,6,8,7,5,9,8,7,6,5,4,3,8,6,4,7,5,3,9,4]))
    P={'A':(2,[1,7,9,10,17]),'B':(3,[1,7,8,12,13]),'C':(4,[1,6,7,12,14]),'D':(5,[1,6,10,18,20]),'E':(2,[2,9,11,14,19]),'F':(3,[2,7,8,10,18]),'G':(4,[2,6,9,10,16]),'H':(5,[2,10,18,19,20]),'I':(2,[3,8,9,10,18]),'J':(3,[3,11,16,17,19]),'K':(4,[3,7,11,15,19]),'L':(5,[3,9,12,14,16]),'M':(2,[4,8,9,10,13]),'N':(3,[4,7,10,14,19]),'O':(4,[4,6,10,15,17]),'P':(5,[4,10,14,18,20]),'Q':(2,[5,9,12,15,19]),'R':(3,[5,8,10,12,13]),'S':(4,[5,6,9,10,19]),'T':(5,[5,6,7,13,16])}
    def ok(c):
        S=set(c);return cost(c)<=17 and not{'B','G'}<=S and not{'F','L'}<=S and not{'J','P'}<=S and not{'N','S'}<=S and ('T' not in S or bool(S&{'H','K'}))
    fe=[''.join(c) for c in product('ABCD','EFGH','IJKL','MNOP','QRST') if ok(c)]
else:
    fe=[''.join(c) for c in combinations('ABCDEFGHIJKL',5) if ok(c)]
top=sorted(fe,key=lambda c:(-val(c),cost(c),c))[:3]
worst=lambda c:min(val(c.replace(f,'')) for f in c)
rob=sorted(fe,key=lambda c:(-worst(c),-val(c),cost(c),c))[0]
ids=lambda x:''.join(sorted(ch for ch in (''.join(x) if isinstance(x,list) else str(x or '')).upper() if ch in 'ABCDEFGHIJKLMNOPQRST'))
a=json.load(open(sys.argv[1])); res={}
res['feasible_count']=a.get('feasible_count')==len(fe)
t=a.get('top3') or []
for i,c in enumerate(top):
    g=t[i] if i<len(t) and isinstance(t[i],dict) else {}
    res[f'top{i+1}_ids']=ids(g.get('ids'))==c; res[f'top{i+1}_cost']=g.get('cost')==cost(c); res[f'top{i+1}_value']=g.get('value')==val(c)
    res[f'top{i+1}_uncovered']=isinstance(g.get('uncovered'),list) and sorted(g.get('uncovered'))==sorted(set(w)-cov(c))
r=a.get('robust_optimum') or {}
res['robust_ids']=ids(r.get('ids'))==rob; res['robust_cost']=r.get('cost')==cost(rob); res['robust_value']=r.get('value')==val(rob); res['robust_worst']=r.get('worst')==worst(rob)
af=r.get('after_failure') or {}
for f in rob: res[f'after_{f}']=af.get(f)==val(rob.replace(f,''))
print(json.dumps({'score':sum(res.values()),'max':len(res),'failed':[k for k,v in res.items() if not v]},ensure_ascii=False))
