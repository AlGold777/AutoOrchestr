const fs = require('fs');
const vm = require('vm');

test('producer keeps current and incoming identities separate and does not lend a current query to a foreign dispatch', () => {
  const source=fs.readFileSync(require.resolve('../background/telemetry-logs'),'utf8');
  const start=source.indexOf('function appendLogEntry('),end=source.indexOf('function isSuccessTerminalDiagnosticState',start),buffer=[];
  const helperStart=source.indexOf('function isPreviousWorkingSessionEvent(event = {}) {');
  const helperEnd=source.indexOf('\nself.discardPendingDiagnostics = discardPendingDiagnostics;',helperStart);
  const context=vm.createContext({self:{__workingSessionStartedAt:0},jobState:{session:{startTime:1,pipelineContext:{pipelineRunId:'r',stageId:'s2'}},llms:{Grok:{lastDispatchMeta:{dispatchId:'d2'},transportRequestId:'q2',tabId:2}}},ensureLogBuffer:()=>buffer,getAppVersion:()=> 'test',TELEMETRY_SCHEMA_VERSION:1,normalizeTelemetryTaxonomy:()=>({}),MAX_LOG_ENTRIES:2,isPinnedTelemetryEvent:()=>false,saveJobState:()=>{},Date});
  vm.runInContext(source.slice(helperStart,helperEnd),context);
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
