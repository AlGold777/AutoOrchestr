/** @jest-environment node */
const fs=require('fs');
const vm=require('vm');
const source=fs.readFileSync(require.resolve('../content-scripts/content-qwen'),'utf8');
function setup(accepted) {
  const messages=[];
  const document={querySelector:()=>({})};
  const button={disabled:false,click:jest.fn(()=>{if(accepted)messages.push('8 / 4');})};
  // The Send readiness gate is covered by claude-send-readiness.test.js; here the editor always accepts Send.
  const c={Date,console,document,window:{ContentUtils:{ensureSendReady:async()=>({ok:true,reason:'ready'})}},KeyboardEvent:class {},sleep:ms=>new Promise(r=>setTimeout(r,ms)),
    resolveQwenChatRoot:()=>({detached:true}),getUserMessages:root=>root===document?messages:[],
    normalizeForComparison:s=>String(s).trim(),extractMessageText:s=>s,
    resolveSendButton:async()=>button,isSafeQwenSendControl:b=>b===button};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  async function sendComposer'),source.indexOf('  function asSelectorArray')),c);
  return {c,button};
}
afterEach(()=>jest.useRealTimers());
test('macOS sends Cmd+Enter before looking for a button and confirms a new user turn',async()=>{
  const {c,button}=setup(false);
  c.navigator={platform:'MacIntel'};
  c.KeyboardEvent=class {constructor(type,init){this.type=type;Object.assign(this,init);}};
  const messages=[];
  c.getUserMessages=()=>messages;
  c.resolveSendButton=jest.fn(async()=>button);
  const input={focus:jest.fn(),dispatchEvent:jest.fn(e=>{
    if(e.type==='keydown' && e.metaKey && !e.ctrlKey) messages.push('8 / 4');
  })};
  await expect(c.sendComposer(input,{prompt:'8 / 4'})).resolves.toBe(true);
  expect(input.focus).toHaveBeenCalledWith({preventScroll:true});
  expect(input.dispatchEvent.mock.calls.map(([e])=>[e.type,e.key,e.metaKey,e.ctrlKey]))
    .toEqual([['keydown','Enter',true,false],['keyup','Enter',true,false]]);
  expect(c.resolveSendButton).not.toHaveBeenCalled();
  expect(button.click).not.toHaveBeenCalled();
});
test.each(['consumed','edited','detached'])('macOS does not click after Cmd+Enter leaves draft %s',async state=>{
  jest.useFakeTimers();
  const {c,button}=setup(false);
  c.navigator={platform:'MacIntel'};
  c.readComposerValue=i=>i.value;
  const input={isConnected:state!=='detached',value:state==='consumed'?'':'edited',dispatchEvent:jest.fn()};
  const pending=c.sendComposer(input,{prompt:'8 / 4'});
  const rejected=expect(pending).rejects.toMatchObject({type:'send_failed'});
  await jest.advanceTimersByTimeAsync(8500);
  await rejected;
  expect(button.click).not.toHaveBeenCalled();
});
test('macOS falls back to Send when Cmd+Enter leaves the exact draft untouched',async()=>{
  jest.useFakeTimers();
  const {c,button}=setup(true);
  c.navigator={platform:'MacIntel'};
  c.readComposerValue=i=>i.value;
  const input={isConnected:true,value:'8 / 4',dispatchEvent:jest.fn()};
  const pending=c.sendComposer(input,{prompt:'8 / 4'});
  await jest.advanceTimersByTimeAsync(2200);
  await expect(pending).resolves.toBe(true);
  expect(button.click).toHaveBeenCalledTimes(1);
});
test('clicks immediately and confirms the new user turn after the original scope is replaced',async()=>{
  const {c,button}=setup(true);
  await expect(c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4',scope:{detached:true}})).resolves.toBe(true);
  expect(button.click).toHaveBeenCalledTimes(1);
});
test('an unrelated spinner or disabled button cannot confirm Send or cause a second click',async()=>{
  jest.useFakeTimers();
  const {c,button}=setup(false);
  button.click.mockImplementation(()=>{button.disabled=true;});
  const pending=c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4'});
  const rejected=expect(pending).rejects.toMatchObject({type:'send_failed'});
  await jest.advanceTimersByTimeAsync(6500);
  await rejected;
  expect(button.click).toHaveBeenCalledTimes(1);
});
test('visible Send bypasses a stalled selector service',async()=>{
  const button={};
  const finder=jest.fn(()=>new Promise(()=>{}));
  const c={window:{SelectorFinder:{findOrDetectSelector:finder}},document:{querySelector:()=>button},
    isSafeQwenSendControl:b=>b===button,console};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  async function resolveSendButton'),source.indexOf('  function requestSubmitNearComposer')),c);
  expect(await c.resolveSendButton(null)).toBe(button);
  expect(finder).not.toHaveBeenCalled();
});

test('Send enabled after paste is clicked during the foreground slot despite a stalled finder',async()=>{
  jest.useFakeTimers();
  const {c,button}=setup(true);
  button.disabled=true;
  c.document.querySelector=()=>button;
  c.document.querySelectorAll=()=>[];
  c.isSafeQwenSendControl=b=>b===button && !b.disabled;
  c.window={SelectorFinder:{findOrDetectSelector:jest.fn(()=>new Promise(()=>{}))},ContentUtils:{ensureSendReady:async()=>{while(button.disabled)await new Promise(r=>setTimeout(r,100));return {ok:true};}}};
  vm.runInContext(source.slice(source.indexOf('  async function resolveSendButton'),source.indexOf('  function requestSubmitNearComposer')),c);
  setTimeout(()=>{button.disabled=false;},300);
  const pending=c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4'});
  await jest.advanceTimersByTimeAsync(500);
  await expect(pending).resolves.toBe(true);
  expect(button.click).toHaveBeenCalledTimes(1);
  expect(c.window.SelectorFinder.findOrDetectSelector).not.toHaveBeenCalled();
});

test('a failure before submission cannot enter last-chance extraction of an old answer',async()=>{
  const error={type:'selector_not_found',message:'No composer'};
  const activity={heartbeat:jest.fn(),error:jest.fn()};
  const c={Date,console,MODEL:'Qwen',window:{},
    runLifecycle:(_name,_context,run)=>run(activity),buildLifecycleContext:()=>({}),
    metricsCollector:{startOperation:()=>1,recordError:jest.fn(),endOperation:jest.fn()},
    sleep:async()=>{},discoverComposer:()=>{throw error;},
    waitForQwenReply:jest.fn(async()=> 'Old answer'),sendResult:jest.fn()};
  vm.createContext(c);
  vm.runInContext(source.slice(source.indexOf('  async function injectAndGetResponse'),source.indexOf('  let currentRequestContext')),c);
  await expect(c.injectAndGetResponse('8 / 4')).rejects.toEqual(error);
  expect(c.waitForQwenReply).not.toHaveBeenCalled();
  expect(c.sendResult).toHaveBeenCalledWith('No composer',false,expect.anything(),error);
});

test('old conversation answers cannot confirm failed keyboard submission',async()=>{
  jest.useFakeTimers();
  const {c}=setup(false);
  c.resolveSendButton=async()=>null;
  c.requestSubmitNearComposer=()=>false;
  c.startDriftFallback=()=>{};
  c.hasQwenGenerationSignal=jest.fn(()=>true);
  c.getAssistantMessages=jest.fn(()=>['Old answer']);
  c.isQwenAnswerCandidate=()=>true;
  const pending=c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4'});
  const rejected=expect(pending).rejects.toMatchObject({type:'send_failed'});
  await jest.advanceTimersByTimeAsync(20000);
  await rejected;
  expect(c.hasQwenGenerationSignal).not.toHaveBeenCalled();
  expect(c.getAssistantMessages).not.toHaveBeenCalled();
});

// L-7: a present but disabled Send is waited for, not replaced by Ctrl+Enter that Qwen may ignore.
test('a disabled visible Send is waited for and clicked, without a Ctrl+Enter', async()=>{
  jest.useFakeTimers();
  const {c,button}=setup(true);
  button.disabled=true;
  setTimeout(()=>{button.disabled=false;},300);
  const input={dispatchEvent:jest.fn()};
  const pending=c.sendComposer(input,{prompt:'8 / 4'});
  await jest.advanceTimersByTimeAsync(600);
  await expect(pending).resolves.toBe(true);
  expect(input.dispatchEvent).not.toHaveBeenCalled();
  expect(button.click).toHaveBeenCalledTimes(1);
});

// L-7: the retry click is idempotent: a reply that appears before it stops the second click.
test('a reply that appears before the retry click is not sent twice', async()=>{
  jest.useFakeTimers();
  const {c,button}=setup(false);
  c.emitDiagnostic=jest.fn();
  const messages=[];
  c.getUserMessages=()=>messages;
  let lookups=0;
  c.resolveSendButton=jest.fn(async()=>{ lookups+=1; if(lookups===2) messages.push('8 / 4'); return button; });
  const pending=c.sendComposer({dispatchEvent:jest.fn()},{prompt:'8 / 4'});
  await jest.advanceTimersByTimeAsync(9000);
  await expect(pending).resolves.toBe(true);
  expect(button.click).toHaveBeenCalledTimes(1);
});
