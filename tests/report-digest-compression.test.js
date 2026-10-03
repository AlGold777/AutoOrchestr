const Digest = require('../shared/report-digest');
const T = 1700000000000;
const report = () => ({ metadata: { debateRunId: 'run' }, runOutcome: {},
  stageExecutions: [{ stageId: 's1', actual: { startedAt: T, participants: ['A'] } }], events: [],
  delivery: { journal: [], diagnosis: { batches: [] } } });
const event = (i, extra = {}) => ({ eventType: 'TEXT_STABLE', sourceTimestamp: T+i,
  correlation: { stageId: 's1', requestId: 'q1', dispatchId: 'd1' },
  payload: { model: 'A', evidence: { textLength: 100, normalizedHash: 'same',
    logCollection: { scope: 'model', limit: 120, appended: i+1, retained: Math.min(i+1,120), evicted: Math.max(0,i-119) }, ...extra } } });

function decodeEvidence(md) {
  const map = new Map();
  for (const line of md.split('\n')) {
    const m=/^([VC]\d+)=(?:(C\d+)\+)?(\{.*\})$/.exec(line);
    if(m)map.set(m[1], {...(m[2]?map.get(m[2]):{}), ...JSON.parse(m[3])});
  }
  const resolve = value => {
    if(value && typeof value==='object' && Object.keys(value).length===1 && value.ref) return resolve(map.get(value.ref));
    if(Array.isArray(value))return value.map(resolve);
    if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,resolve(v)]));
    return value;
  };
  return [...map.values()].map(resolve);
}

test('poll counters do not split observations; actual first/last collection samples survive', () => {
  const d=report();d.events=Array.from({length:600},(_,i)=>event(i));
  const before=JSON.stringify(d), x=Digest.extractTransport(d), md=Digest.renderTransportMarkdown(x);
  expect(x.requests[0].transitions).toHaveLength(1);
  expect(x.requests[0].transitions[0].count).toBe(600);
  expect(x.collectionSamples[0]).toMatchObject({count:600,resets:0,first:{path:'events[0]'},last:{path:'events[599]',value:{appended:600,evicted:480}}});
  expect(Buffer.byteLength(md)).toBeLessThan(20000);
  expect(JSON.stringify(d)).toBe(before);
});

test('returning hashes and reasons remain ordered transitions, not a set of unique states', () => {
  const d=report();d.events=[event(0,{normalizedHash:'a',reason:'x'}),event(1,{normalizedHash:'b',reason:'y'}),event(2,{normalizedHash:'a',reason:'x'})];
  const x=Digest.extractTransport(d);
  expect(x.requests[0].transitions.map(r=>r.first.evidence.normalizedHash)).toEqual(['a','b','a']);
});

test('interleaved cards are independent streams; repeated cycles retain their full state order', () => {
  const d=report();d.events=[event(0)];
  d.delivery.journal=Array.from({length:400},(_,i)=>({kind:'displayed',at:T+i,model:'A',requestId:'q1',dispatchId:'d1',
    chars:100,pageId:'page',cardTargetType:i%2?'main':'pipeline',outcome:'wrong_card',
    expectedCardId:i%4<2?null:'card',answerArtifact:{representation:'rendered_text',normalizedHash:'same',normalizedLength:100}}));
  const x=Digest.extractTransport(d), md=Digest.renderTransportMarkdown(x);
  expect(x.requests[0].counts.displayed).toBe(400);
  expect(x.requests[0].background).toHaveLength(400); // changing expected identity, not discarded
  expect(md).toContain('(b1→b2→b3→b4)×100');
  const values=decodeEvidence(md);
  expect(values).toContainEqual(expect.objectContaining({expectedCardId:null,cardTargetType:'main'}));
  expect(values).toContainEqual(expect.objectContaining({expectedCardId:'card',cardTargetType:'main'}));
  expect(Buffer.byteLength(md)).toBeLessThan(25000);
  d.delivery.journal.forEach(r=>r.expectedCardId=null);
  const stable=Digest.extractTransport(d);
  expect(stable.requests[0].background).toHaveLength(2);
  expect(stable.requests[0].background.map(r=>r.count)).toEqual([200,200]);
});

test('refusals aggregate consecutive equal reasons but split changes and counter resets', () => {
  const d=report();d.delivery.diagnosis.batches=[{at:T,refusals:[
    {at:T+1,attempt:1,waitedMs:10,errorCode:'BUSY'}, {at:T+2,attempt:2,waitedMs:20,errorCode:'BUSY'},
    {at:T+3,attempt:3,waitedMs:30,errorCode:'OTHER'}, {at:T+4,attempt:4,waitedMs:40,errorCode:'BUSY'},
    {at:T+5,attempt:1,waitedMs:5,errorCode:'BUSY'}]}];
  const text=Digest.renderTransportMarkdown(Digest.extractTransport(d));
  const section=text.split('### 9. Start refusals')[1].split('### 10.')[0];
  expect(section.match(/^- /gm)).toHaveLength(4);
  expect(section).toContain('×2 BUSY');expect(section).toContain('cumulative waitedMs=10→20');
  expect(text).toContain('B[0].refusals[0..1]');
});

test('native answer proof remains available when duplicate artifact table is removed', () => {
  const d=report();const e=event(0);e.eventType='ANSWER_ACCEPTANCE_DECIDED';e.payload.answerProof={normalizedHash:'proof',normalizedLength:100};d.events=[e];
  const md=Digest.renderTransportMarkdown(Digest.extractTransport(d));
  expect(decodeEvidence(md)).toContainEqual(expect.objectContaining({answerProof:{normalizedHash:'proof',normalizedLength:100}}));
});

test('empty objects, null and missing evidence fields stay distinct after dictionary compression', () => {
  const d=report();d.events=[event(0,{custom:{},nullable:null}),event(1,{custom:{}})];
  const x=Digest.extractTransport(d), values=decodeEvidence(Digest.renderTransportMarkdown(x));
  expect(x.requests[0].transitions).toHaveLength(2);
  expect(values.some(v=>v.custom && Object.keys(v.custom).length===0 && v.nullable===null)).toBe(true);
  expect(values.some(v=>v.custom && Object.keys(v.custom).length===0 && !Object.hasOwn(v,'nullable'))).toBe(true);
});

test('nine models over four rounds stay compact despite 2880 poll records', () => {
  const d=report();
  d.stageExecutions=Array.from({length:4},(_,i)=>({stageId:`s${i}`,actual:{startedAt:T+i*10000,participants:Array.from({length:9},(_,n)=>`m${n}`)}}));
  d.events=Array.from({length:2880},(_,i)=>{
    const request=Math.floor(i/80),stage=Math.floor(request/9),model=`m${request%9}`;
    const e=event(i);e.correlation={stageId:`s${stage}`,requestId:`q${request}`,dispatchId:`d${request}`};e.payload.model=model;return e;
  });
  const x=Digest.extractTransport(d), md=Digest.renderTransportMarkdown(x);
  expect(x.requests).toHaveLength(36);
  expect(x.requests.every(r=>r.transitions.length===1 && r.transitions[0].count===80)).toBe(true);
  expect(Buffer.byteLength(md)).toBeLessThan(80000);
});
