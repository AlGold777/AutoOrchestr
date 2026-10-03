const Persistence = require('../disput/debate-orchestrator-persistence');

function setup(limit = 2500) {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => {
      const size = [...values].reduce((sum, [name, item]) => sum + (name === key ? 0 : item.length), value.length);
      if (size > limit) throw Object.assign(new Error('quota exceeded'), { name: 'QuotaExceededError' });
      values.set(key, value);
    },
    removeItem: key => values.delete(key)
  };
  const onStorageError = jest.fn();
  const persistence = Persistence.createPersistence({ runId: 'large', storage, onStorageError });
  return { persistence, storage, values, onStorageError };
}

test('36 large answers survive quota exhaustion with checkpoints and publication cursor intact', () => {
  const { persistence, storage, onStorageError } = setup();
  expect(persistence.writeLease({ ownerId: 'a', leaseRevision: 1 })).toBe(true);
  persistence.saveSnapshot({ eventSequence: 0 });
  const expected = Array.from({ length: 36 }, (_, i) => ({
    eventId: `e${i}`, eventSequence: i + 1, type: 'ANSWER_RECEIVED', payload: { text: `${i}:` + 'x'.repeat(1500) }
  }));
  expected.forEach(event => {
    persistence.appendEvent(event);
    persistence.markPublished(event.eventSequence);
    persistence.saveSnapshot({ eventSequence: event.eventSequence, text: event.payload.text });
  });
  expect(persistence.loadEvents()).toEqual(expected);
  expect(persistence.loadLatestSnapshot().eventSequence).toBe(36);
  expect(persistence.readLastPublishedSequence()).toBe(36);
  expect(persistence.getStorageStatus()).toMatchObject({ mode: 'memory', durable: false, error: { name: 'QuotaExceededError' } });
  expect(onStorageError).toHaveBeenCalledTimes(1);
  const other = Persistence.createPersistence({ runId: 'large', storage });
  expect(other.loadEvents()).toEqual([]); // Never recover a stale partial run.
  expect(other.loadLatestSnapshot()).toBeNull();
  expect(other.compareAndSetLease(0, { ownerId: 'b', leaseRevision: 1 })).toBe(false);
  expect(other.compareAndSetLease(1, { ownerId: 'b', leaseRevision: 2 })).toBe(true);
  expect(persistence.readLease().ownerId).toBe('b');
});

test('snapshot overflow retains events and checkpoint data in memory', () => {
  const { persistence } = setup();
  persistence.appendEvent({ eventId: 'e1', eventSequence: 1, type: 'RUN_STATE_CHECKPOINTED', payload: { snapshot: { state: 'paused' } } });
  persistence.saveSnapshot({ eventSequence: 1, text: 'x'.repeat(5000) });
  expect(persistence.loadEvents()).toHaveLength(1);
  expect(persistence.loadRecoveryCheckpoint()).toEqual({ state: 'paused' });
  expect(persistence.loadLatestSnapshot().text).toHaveLength(5000);
  persistence.clear();
  expect(persistence.loadEvents()).toEqual([]);
  expect(persistence.durable).toBe(true);
});

test('lease quota failures never claim ownership through an in-memory fallback', () => {
  const { persistence } = setup(1);
  expect(persistence.writeLease({ ownerId: 'a', leaseRevision: 1 })).toBe(false);
  expect(persistence.compareAndSetLease(0, { ownerId: 'a', leaseRevision: 1 })).toBe(false);
  expect(persistence.readLease()).toBeNull();
});

test('page mode retains a run larger than Web Storage quota without any run-data writes', () => {
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: jest.fn((key,value) => {
      if (!key.endsWith(':lease')) throw new Error('run data must never use Web Storage');
      values.set(key,value);
    }),
    removeItem: key => values.delete(key)
  };
  const onStorageError = jest.fn();
  const first = Persistence.createPersistence({runId:'page',storage,persistRunData:false,onStorageError});
  expect(first.compareAndSetLease(0,{ownerId:'a',leaseRevision:1})).toBe(true);
  const events=Array.from({length:36},(_,i)=>({eventId:`e${i}`,eventSequence:i+1,payload:{text:'x'.repeat(150000)}}));
  events.forEach(e=>first.appendEvent(e));
  first.saveSnapshot({eventSequence:36,text:'x'.repeat(150000)});
  first.markPublished(36);
  expect(first.loadEvents()).toEqual(events);
  expect(first.loadLatestSnapshot().eventSequence).toBe(36);
  expect(first.readLastPublishedSequence()).toBe(36);
  expect(first.getStorageStatus()).toMatchObject({mode:'memory',durable:false,error:null});
  expect(onStorageError).not.toHaveBeenCalled();
  expect(storage.setItem).toHaveBeenCalledTimes(1);
  const second=Persistence.createPersistence({runId:'page',storage,persistRunData:false});
  expect(second.loadEvents()).toEqual([]);
  expect(second.compareAndSetLease(0,{ownerId:'b',leaseRevision:1})).toBe(false);
  expect(second.compareAndSetLease(1,{ownerId:'b',leaseRevision:2})).toBe(true);
  expect(first.readLease().ownerId).toBe('b');
});

test('page mode removes old run archives while preserving settings and shared leases', () => {
  const values=new Map([
    ['disputOrchestratorV2:old:events','[]'],['disputOrchestratorV2:old:snapshots','[]'],
    ['disputOrchestratorV2:old:published','123'],['disputOrchestratorV2:old:lease','{"ownerId":"live"}'],
    ['theme','dark'],['other:events','important']
  ]);
  const storage={get length(){return values.size;},key:i=>[...values.keys()][i],
    getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  Persistence.createPersistence({runId:'new',storage,persistRunData:false});
  expect([...values.keys()]).toEqual(['disputOrchestratorV2:old:lease','theme','other:events']);
});

test('extension page explicitly keeps run records in memory with shared persistence enabled', () => {
  const fs=require('fs'),path=require('path');
  const source=fs.readFileSync(path.join(__dirname,'../results.js'),'utf8');
  expect(source).toMatch(/enableDurablePersistence: true,\s+persistRunData: false,/);
});

test('a full browser store does not grant an exclusive lease via private memory', () => {
  const fs=require('fs'),path=require('path'),vm=require('vm');
  const storage={getItem:()=>null,setItem:()=>{throw Object.assign(new Error('full'),{name:'QuotaExceededError'});},removeItem:()=>{}};
  const context={window:{localStorage:storage},module:{exports:{}}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../disput/debate-orchestrator-persistence.js'),'utf8'),context);
  const persistence=context.module.exports.createPersistence({runId:'full-browser',persistRunData:false});
  expect(persistence.compareAndSetLease(0,{ownerId:'a',leaseRevision:1})).toBe(false);
  expect(persistence.readLease()).toBeNull();
});
