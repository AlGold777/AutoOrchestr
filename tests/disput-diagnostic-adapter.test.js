const fs = require('fs');
const vm = require('vm');
const Schema = require('../disput/debate-trace-schema');
global.DebateTraceSchema = Schema;
const Store = require('../disput/debate-trace-store');
const Projections = require('../disput/debate-trace-projections');

function adapter() {
  const store = Store.createStore();
  store.beginRun({ debateRunId: 'run-adapter' });
  const source = fs.readFileSync(require.resolve('../results.js'), 'utf8');
  const start = source.indexOf('    const diagnosticTraceMapping =');
  const end = source.indexOf("    document.addEventListener('change'", start);
  const context = vm.createContext({ debateTraceStore: store, appendDebateTraceEvent: input => store.append(input), Date });
  vm.runInContext(source.slice(start,end) + '\nglobalThis.ingest = appendDebateDiagnosticTrace;', context);
  return { store, ingest: context.ingest };
}

test('actual diagnostic adapter preserves proof, identity, null and zero through exported schema', () => {
  const {store,ingest} = adapter();
  ingest('Grok', { ts: 0, label: 'FINALIZATION_DECISION', meta: { pipelineRunId: 'run-adapter', requestId: 'q1', dispatchId: 'd1', answerLength: 0, focusSwitchesUsed: 0, doneReason: null, causality: { parentEventId:'parent' } } });
  ingest('Grok', { ts: 1, label: 'ANSWER_CARD_RENDER_EVALUATED', details: 'wrong_card', level: 'warning', meta: { requestId:'q1', dispatchId:'d1', normalizedHash:'fnv1a:1234', normalizationVersion:'v1', expectedCardId:'c1', observedCardId:'c2', usableResult:false } });
  const report = Projections.buildReport(store.getActiveRun());
  const final = report.events.find(e=>e.eventType==='MODEL_TERMINAL_COMMITTED');
  expect(final).toMatchObject({ sourceTimestamp:0, correlation:{ transportRequestId:'q1', requestId:'q1', dispatchId:'d1' }, payload:{ answerLength:0, evidence:{ focusSwitchesUsed:0, doneReason:null } }, causality:{parentEventId:'parent'} });
  const render = report.events.find(e=>e.payload.originalLabel==='ANSWER_CARD_RENDER_EVALUATED');
  expect(render.payload.evidence).toMatchObject({normalizedHash:'fnv1a:1234', expectedCardId:'c1', observedCardId:'c2', usableResult:false});
});

test('root identity alone is inferred and observer stop is a distinct typed fact', () => {
  const {store,ingest} = adapter();
  ingest('Grok', { ts: 10, label:'ANSWER_TEXT_STABLE', meta:{pipelineRunId:'run-adapter',textLength:0} });
  ingest('Grok', { ts:11, label:'LIFECYCLE_TRACKING_STOPPED', meta:{dispatchId:'d1',stopReason:'spa_navigation',observerStoppedAt:11} });
  const report = Projections.buildReport(store.getActiveRun());
  expect(report.events.find(e=>e.eventType==='TEXT_STABLE').correlation.correlationQuality).toBe('inferred');
  expect(report.events.find(e=>e.eventType==='OBSERVER_STOPPED').payload.evidence).toMatchObject({stopReason:'spa_navigation',observerStoppedAt:11});
});

test('producer keeps current and incoming identities separate and does not lend a current query to a foreign dispatch', () => {
  const source=fs.readFileSync(require.resolve('../background/telemetry-logs'),'utf8');
  const start=source.indexOf('function appendLogEntry('),end=source.indexOf('function isSuccessTerminalDiagnosticState',start),buffer=[];
  const context=vm.createContext({jobState:{session:{startTime:1,pipelineContext:{pipelineRunId:'r',stageId:'s2'}},llms:{Grok:{lastDispatchMeta:{dispatchId:'d2'},transportRequestId:'q2',tabId:2}}},ensureLogBuffer:()=>buffer,getAppVersion:()=> 'test',TELEMETRY_SCHEMA_VERSION:1,normalizeTelemetryTaxonomy:()=>({}),MAX_LOG_ENTRIES:2,isPinnedTelemetryEvent:()=>false,saveJobState:()=>{},Date});
  vm.runInContext(source.slice(start,end),context);
  const foreign=context.appendLogEntry('Grok',{ts:0,meta:{dispatchId:'d1',stageId:'s1'}});
  expect(foreign.ts).toBe(0);
  expect(foreign.meta.transportRequestId).toBeNull();
  expect(foreign.meta.incomingIdentity).toMatchObject({dispatchId:'d1',stageId:'s1'});
  expect(foreign.meta.expectedIdentity).toMatchObject({dispatchId:'d2',stageId:'s2',transportRequestId:'q2'});
  const own=context.appendLogEntry('Grok',{meta:{dispatchId:'d2'}});
  expect(own.meta.transportRequestId).toBe('q2');
  expect(own.meta.correlationQuality).toBe('exact');
  const inferred=context.appendLogEntry('Grok',{});
  expect(inferred.meta.correlationQuality).toBe('inferred');
  expect(inferred.meta.logCollection).toMatchObject({appended:3,evicted:1,retained:2});
});
