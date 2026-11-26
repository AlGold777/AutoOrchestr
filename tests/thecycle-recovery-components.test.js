'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {reconcile}=require('../disput/thecycle/transport-reconciliation.js');
const {createRecoveryStateMachine}=require('../disput/thecycle/recovery-state-machine.js');
const {createDatabaseActivationManager}=require('../disput/thecycle/database-activation.js');
const {planRetention}=require('../disput/thecycle/backup-retention.js');
test('unknown dispatch never authorizes replay',()=>{
 const r=reconcile({run:{runId:'r'},batches:[{batchId:'b'}],evidence:[],ownerEpoch:1});
 assert.equal(r.resolved,false);assert.equal(r.mayResume,false);
});
test('verified response is recognized but not replayed',()=>{
 const r=reconcile({run:{runId:'r'},batches:[{batchId:'b'}],
 evidence:[{runId:'r',batchId:'b',ownerEpoch:1,status:'RESPONSE',verified:true,source:'tab',reference:'1'}],ownerEpoch:1});
 assert.equal(r.resolved,true);assert.equal(r.mayResume,false);
});
test('state machine rejects illegal transition',async()=>{
 const repository={load:async()=>({phase:'IDLE',revision:0}),compareAndSet:async()=>true};
 const machine=createRecoveryStateMachine({repository});
 await assert.rejects(machine.transition('r',0,'ACTIVATING'),/RECOVERY_ILLEGAL_TRANSITION/);
});
test('activation rejects unverified target',async()=>{
 const manager=createDatabaseActivationManager({
 registry:{read:async()=>({revision:0}),compareAndSet:async()=>true},
 inspectDatabase:async()=>({verified:false,paused:true,hasActiveOwner:false}),
 verifyQuiescence:async()=>({quiescent:true,verified:true})});
 await assert.rejects(manager.activate({targetName:'auto-orchestr-thecycle-restore-12345678',expectedRevision:0}),/ACTIVATION_UNSAFE/);
});
test('retention protects pending backup',()=>{
 const records=Array.from({length:3},(_,i)=>({key:'k'+i,createdAt:i,verified:true,pendingCommit:i===0}));
 assert.deepEqual(planRetention({records,keep:2}).deleteCandidates,[]);
});
