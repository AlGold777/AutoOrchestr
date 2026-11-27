# usage: python3 -I extract.py cards.json outdir  -> scores the LAST parseable result JSON of each card
import json,sys,re,subprocess,os
cards=json.load(open(sys.argv[1])); out=sys.argv[2]; os.makedirs(out,exist_ok=True)
def blocks(t):
    res=[]
    for m in re.finditer(r'\{',t):
        i=m.start(); depth=0
        for j in range(i,len(t)):
            depth+= t[j]=='{'; depth-= t[j]=='}'
            if depth==0:
                try:
                    o=json.loads(t[i:j+1])
                    if isinstance(o,dict) and 'feasible_count' in o: res.append(o)
                except Exception: pass
                break
    return res
for i,c in enumerate(cards):
    lab=c['head'].replace('\n',' ')[:24]; b=blocks(c['text'])
    if not b: print(i,lab,'NO_JSON'); continue
    p=os.path.join(out,'ans%02d.json'%i); json.dump(b[-1],open(p,'w'))
    r=subprocess.run(['python3','-I',os.path.join(os.path.dirname(os.path.abspath(__file__)),'myscore.py'),p],capture_output=True,text=True).stdout.strip()
    print(i,lab,'blocks',len(b),r[:150])
