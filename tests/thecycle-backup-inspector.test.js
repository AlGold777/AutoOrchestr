'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inspectBackup}=require('../disput/thecycle/backup-inspector.js');
test('inspector rejects malformed keys without reading storage',async()=>{
 await assert.rejects(inspectBackup({key:'../unsafe'}),/INVALID_BACKUP_KEY/);
});
test('inspector requires all verification modules',async()=>{
 await assert.rejects(inspectBackup({key:'safe-backup'}),/RECOVERY_MODULES_MISSING/);
});
test('restore validation rejects orphan packets',()=>{
 const {validate}=require('../disput/thecycle/restore-service.js');
 const snapshot={format:'thecycle-idb-snapshot',version:1,databaseVersion:1,
 stores:{research:[],control:[],runs:[],events:[],packets:[{researchId:'missing',cycleId:1}]}};
 assert.throws(()=>validate(snapshot),/RESTORE_ORPHAN_ROW/);
});
