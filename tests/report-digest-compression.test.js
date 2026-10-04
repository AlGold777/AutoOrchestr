const Digest = require('../shared/report-digest');
const T = 1700000000000;
const report = () => ({ metadata: { debateRunId: 'run' }, runOutcome: {},
  stageExecutions: [{ stageId: 's1', actual: { startedAt: T, participants: ['A'] } }], events: [],
  delivery: { journal: [], diagnosis: { batches: [] } } });
const event = (i, extra = {}) => ({ eventType: 'TEXT_STABLE', sourceTimestamp: T+i,
  correlation: { stageId: 's1', requestId: 'q1', dispatchId: 'd1' },
  payload: { model: 'A', evidence: { textLength: 100, normalizedHash: 'same',
    logCollection: { scope: 'model', limit: 120, appended: i+1, retained: Math.min(i+1,120), evicted: Math.max(0,i-119) }, ...extra } } });

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

test('interleaved cards retain structured changes and Markdown counters and source endpoints', () => {
  const d=report();d.events=[event(0)];
  d.delivery.journal=Array.from({length:400},(_,i)=>({kind:'displayed',at:T+i,model:'A',requestId:'q1',dispatchId:'d1',
    chars:100,pageId:'page',cardTargetType:i%2?'main':'pipeline',outcome:'wrong_card',
    expectedCardId:i%4<2?null:'card',answerArtifact:{representation:'rendered_text',normalizedHash:'same',normalizedLength:100}}));
  const x=Digest.extractTransport(d), md=Digest.renderTransportMarkdown(x);
  expect(x.requests[0].counts.displayed).toBe(400);
  expect(x.requests[0].background).toHaveLength(400); // changing expected identity, not discarded
  expect(md).toContain('pipeline/wrong_card:200');
  expect(md).toContain('main/wrong_card:200');
  expect(x.requests[0].background.map(r=>r.first.evidence.expectedCardId)).toEqual(expect.arrayContaining([null,'card']));
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
  expect(text).toContain('B[0].refusals[0]');
  expect(text).toContain('B[0].refusals[1]');
});

test('native answer proof remains available when duplicate artifact table is removed', () => {
  const d=report();const e=event(0);e.eventType='ANSWER_ACCEPTANCE_DECIDED';e.payload.answerProof={normalizedHash:'proof',normalizedLength:100};d.events=[e];
  const x=Digest.extractTransport(d),md=Digest.renderTransportMarkdown(x);
  expect(x.requests[0].transitions[0].first.evidence.answerProof).toEqual({normalizedHash:'proof',normalizedLength:100});
  expect(md).toContain('E[0]');
});

test('empty objects, null and missing evidence fields stay distinct in structured facts alongside compact Markdown', () => {
  const d=report();d.events=[event(0,{answerProof:{},stopReason:null}),event(1,{answerProof:{}})];
  const x=Digest.extractTransport(d), values=x.requests[0].transitions.map(r=>r.first.evidence);
  expect(x.requests[0].transitions).toHaveLength(2);
  expect(values.some(v=>v.answerProof && Object.keys(v.answerProof).length===0 && v.stopReason===null)).toBe(true);
  expect(values.some(v=>v.answerProof && Object.keys(v.answerProof).length===0 && !Object.hasOwn(v,'stopReason'))).toBe(true);
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
  expect(Buffer.byteLength(md)).toBeLessThanOrEqual(70000);
});


test('background length/status/dispatch returns are ordered and repeated cycles are lossless', () => {
  const d=report();d.events=[event(0)];
  d.delivery.journal=Array.from({length:400},(_,i)=>({kind:'status',at:T+i,model:'A',requestId:'q1',dispatchId:i%2?'d2':'d1',chars:i%2?200:100,status:i%2?'complete':'printing'}));
  const x=Digest.extractTransport(d),md=Digest.renderTransportMarkdown(x);
  expect(x.requests[0].background).toHaveLength(400);
  expect(x.requests[0].background.map(r=>[r.first.textLength,r.first.status,r.first.dispatchId])).toEqual(Array.from({length:400},(_,i)=>i%2?[200,'complete','d2']:[100,'printing','d1']));
  expect(md).toContain('J[0]');
  expect(md).toContain('J[399]');
});

test('render null hash never falls back to artifact hash; unavailable time is not zero', () => {
  const d=report();delete d.stageExecutions[0].actual.startedAt;
  d.events=[event(0),{...event(1,{normalizedHash:null,answerArtifact:{normalizedHash:'fallback'}}),eventType:'ANSWER_CARD_RENDER_EVALUATED'}];
  const x=Digest.extractTransport(d),md=Digest.renderTransportMarkdown(x);
  expect(x.requests[0].background.find(r=>r.first.type==='ANSWER_CARD_RENDER_EVALUATED').first.evidence.normalizedHash).toBeNull();
  expect(md).toContain('E[1]');
  expect(x.sourceStatus.windowStart).toBeNull();
  expect(md).toContain('— in time columns means no usable time field (never zero)');
});


test('large auxiliary identity and lineage objects stay in JSON without bloating Markdown', () => {
  const d=report();d.events=[event(0)];
  const lineage={selectedInputs:Array.from({length:40},(_,i)=>({id:`input-${i}`,producerNote:'x'.repeat(800)}))};
  d.delivery.journal=Array.from({length:400},(_,i)=>({kind:'displayed',at:T+i,model:'A',requestId:'q1',chars:100,outcome:'displayed',promptLineage:lineage,expectedIdentity:{runId:'run',auxiliaryNote:'y'.repeat(800)},answerArtifact:{normalizedHash:'same',normalizedLength:100}}));
  const before=JSON.stringify(d),x=Digest.extractTransport(d),md=Digest.renderTransportMarkdown(x);
  expect(x.requests[0].background[0].first.evidence.promptLineage).toEqual(lineage);
  expect(md).not.toContain('producerNote');
  expect(md).toContain('J[0]');
  expect(md).toContain('J[399]');
  expect(Buffer.byteLength(md)).toBeLessThan(18000);
  expect(JSON.stringify(d)).toBe(before);
});


test('oversized UTF-8 output fails explicitly instead of silently truncating or downloading a giant extract', () => {
  const x=Digest.extractTransport(report());
  x.manual.rows=[{path:'events[0]',details:'Ж'.repeat(40000)}];
  expect(()=>Digest.renderTransportMarkdown(x)).toThrow(/exceeds 70000 bytes/);
});

test('multiple rounds and repeated recovery/display observations fit the output budget', () => {
  const d=report(),models=Array.from({length:9},(_,i)=>`Model${i}`);
  d.stageExecutions=Array.from({length:4},(_,i)=>({stageId:`s${i}`,actual:{startedAt:T+i*10000,participants:models}}));
  for(let stage=0;stage<4;stage++)for(let model=0;model<9;model++){
    const request=`q${stage}_${model}`,dispatch=`d${stage}_${model}`;
    for(let i=0;i<80;i++){
      const e=event(stage*10000+i,{textLength:i*100,normalizedHash:`hash${i}`});
      e.correlation={stageId:`s${stage}`,requestId:request,dispatchId:dispatch};e.payload.model=models[model];
      if(i%4===0){e.eventType='LEGACY_DIAGNOSTIC_EVENT';e.payload.originalLabel='RECOVERY_BUDGET_EXHAUSTED';e.reasonCode='budget';}
      d.events.push(e);
      d.delivery.journal.push({kind:'displayed',model:models[model],requestId:request,dispatchId:dispatch,at:T+stage*10000+i,chars:i*100,outcome:'wrong_card',cardTargetType:'pipeline'});
    }
    d.events.push({eventType:'MODEL_TERMINAL_COMMITTED',sourceTimestamp:T+stage*10000+9999,correlation:{stageId:`s${stage}`,requestId:request,dispatchId:dispatch},payload:{model:models[model],answerLength:7900,evidence:{finalStatus:'SUCCESS',completionReason:'lifecycle_complete_snapshot',answerLen:7900}}});
  }
  const x=Digest.extractTransport(d),md=Digest.renderTransportMarkdown(x);
  expect(x.requests).toHaveLength(36);
  expect(Buffer.byteLength(md)).toBeLessThanOrEqual(70000);
  expect(md).toContain('Q36');
  expect(md).toContain('RECOVERY_BUDGET_EXHAUSTED');
  expect(md).not.toContain('Grouping evidence dictionary');
});
