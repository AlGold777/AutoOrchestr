'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createActiveStateStore}=require('../disput/thecycle/active-state-store.js');
const {createActivationCoordinator}=require('../disput/thecycle/activation-coordinator.js');
test('active state store refuses missing dependencies',async()=>{
 await assert.rejects(createActiveStateStore(),/ACTIVE_STORE_DEPENDENCIES_MISSING/);
});
test('activation coordinator refuses a live writer before CAS',async()=>{
 let activated=false;
 const coordinator=createActivationCoordinator({
  registry:{},inspectDatabase:async()=>({verified:true,paused:true,hasActiveOwner:false}),
  activeWriters:async()=>1,
  verifyQuiescence:async()=>({verified:true,quiescent:true,source:'browser',reference:'id'}),
  activationManager:{createDatabaseActivationManager:({verifyQuiescence})=>({
   activate:async()=>{await verifyQuiescence();activated=true;}
  })}
 });
 await assert.rejects(coordinator.activate({targetName:'auto-orchestr-thecycle-restore-12345678',expectedRevision:0}),
  /ACTIVATION_WRITERS_PRESENT/);
 assert.equal(activated,false);
});
test('activation coordinator refuses unverified transport',async()=>{
 const coordinator=createActivationCoordinator({
  registry:{},activeWriters:async()=>0,
  verifyQuiescence:async()=>({verified:false,quiescent:true}),
  activationManager:{createDatabaseActivationManager:({verifyQuiescence})=>({
   activate:()=>verifyQuiescence()
  })}
 });
 await assert.rejects(coordinator.activate(),/ACTIVATION_TRANSPORT_UNVERIFIED/);
});
