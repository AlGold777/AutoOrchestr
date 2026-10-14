const path=require('path');
const root=path.resolve(__dirname, '../../..');
const Engine=require(path.join(root,'disput/custom-engine.js'));
const Record=require(path.join(root,'disput/custom-run-record.js'));
(async()=>{
const src={artifact:{step:'r1',participant:'A',id:'map'},version:'latest',required:true};
const out={artifacts:[{id:'map',name:'Map',pointer:''}]};
const rev={artifacts:[{id:'map',name:'Revised',pointer:'',revisionOf:src}]};
let gates=0,ownerCalls=0;
const run=await Engine.run({task:'T',maxAttempts:1,steps:[
 {ref:'r1',kind:'round',input:'none',models:['A'],output:out},
 {ref:'owner:revise',kind:'owner',task:'Revise',input:[src],output:rev,models:[]},
 {ref:'gate:g',kind:'gate',input:'previous',criteria:['check'],models:['C'],onFail:{goto:'owner:revise',maxLoops:1}},
 {ref:'r2',kind:'round',models:['D'],input:[src]}
],send:async(models)=>({byModel:Object.fromEntries(models.map(m=>[m,{text:m==='C'?(++gates===1?'НЕ ВЫПОЛНЕНО: check\nВЕРДИКТ: НЕ ПРОШЁЛ':'ВЕРДИКТ: ПРОШЁЛ'):'v1',status:'SUCCESS'}]))}),provideOwnerResult:async()=>`owner-v${++ownerCalls}`,decide:async()=> 'skip'});
console.log('owner revision on return',JSON.stringify({reason:run.stopReason,detail:run.stopDetail,ownerCalls}));
const Schema=require(path.join(root,'disput/basic-schema.js'));
for(const input of ['none','all']){
 const schema={schemaVersion:1,origin:'user',steps:[{ref:'r1',kind:'round',models:[{name:'GPT'}]},{ref:'owner:answer',kind:'owner',task:'Read inputs',models:[],input}]};
 const errors=Schema.validate(schema);let received;
 const direct=await Engine.run({task:'T',steps:schema.steps,send:async()=>({byModel:{GPT:{text:'source-answer',status:'SUCCESS'}}}),provideOwnerResult:async(arg)=>{received=arg.input;return 'answer';}});
 console.log('owner input enum',JSON.stringify({input,errors,runtimeStop:direct.stopReason,received}));
}
})();
