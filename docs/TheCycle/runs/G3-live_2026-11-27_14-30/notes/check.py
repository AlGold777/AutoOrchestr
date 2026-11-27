import itertools,json,re,sys,glob,os
w={i+1:v for i,v in enumerate([9,6,8,7,5,9,8,7,6,5,4,3])}
P={k:(c,set(map(int,s.split(',')))) for k,c,s in [('A',2,'1,7,9'),('B',3,'1,7,8,12'),('C',4,'1,6,7,11'),('D',2,'2,9,11'),('E',3,'2,4,8,10'),('F',4,'2,6,9,10'),('G',2,'3,8,10'),('H',3,'3,4,5,11'),('I',4,'3,6,9,12'),('J',2,'4,5,10'),('K',3,'4,7,11,12'),('L',4,'4,5,6,8')]}
val=lambda ids:sum(w[e] for e in set().union(*(P[i][1] for i in ids)))
F=[]
for c in itertools.product('ABC','DEF','GHI','JKL'):
    cost=sum(P[i][0] for i in c)
    if cost>12 or any(a in c and b in c for a,b in ['BF','EK','CI','HL']): continue
    ids=''.join(c); after={x:val([i for i in c if i!=x]) for x in c}
    F.append((ids,cost,val(c),min(after.values()),after))
top=sorted(F,key=lambda r:(-r[2],r[1],r[0]))[:3]
rob=sorted(F,key=lambda r:(-r[3],-r[2],r[1],r[0]))[0]
print('feasible',len(F)); print('top3',[(r[0],r[1],r[2]) for r in top]); print('robust',rob)
for n in ['BDGJ','BDGK','BDGL','CDGL']:
    print(n, next(((r[1],r[2],r[3],r[4]) for r in F if r[0]==n),'infeasible'), 'value',val(n))
truth=dict(feasible_count=len(F),top3=[[list(r[0]),r[1],r[2]] for r in top],robust=[list(rob[0]),rob[1],rob[2],rob[3],rob[4]])
for f in sorted(glob.glob(os.path.dirname(__file__)+'/c1_*_text.txt'))+sys.argv[1:]:
    t=open(f).read(); i=t.find('{'); 
    try: j,_=json.JSONDecoder().raw_decode(t[i:])
    except Exception as e: print(os.path.basename(f),'JSON error',e); continue
    r=j['robust_optimum']
    ok=dict(count=j['feasible_count']==len(F),
      top3=[[x['ids'],x['cost'],x['value']] for x in j['top3']]==truth['top3'] and all(set(x['uncovered'])==set(w)-set().union(*(P[i][1] for i in x['ids'])) for x in j['top3']),
      robust=[r['ids'],r['cost'],r['value'],r['worst'],r['after_failure']]==truth['robust'])
    print(os.path.basename(f),ok)
