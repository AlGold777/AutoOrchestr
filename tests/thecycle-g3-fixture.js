'use strict';
// Shared Circle fixture for the G3.3 tests: fake IndexedDB, fake bridge, queues of model answers.
const { createFakeIndexedDB, installKeyRange } = require('./thecycle-fake-idb.js');
require('../disput/custom-engine.js');
require('../disput/basic-schema.js');
const { createStateStore } = require('../disput/thecycle/state-store.js');
const { createBasicAdapter } = require('../disput/thecycle/basic-adapter.js');
const { createController } = require('../disput/thecycle/controller.js');
const context = require('../disput/thecycle/circle-context.js');
const policyApi = require('../disput/thecycle/circle-policy.js');
const { createCircleRunner } = require('../disput/thecycle/circle-runtime.js');
const { createBackupGate } = require('../disput/thecycle/backup-gate.js');
installKeyRange();
const clone = (v) => JSON.parse(JSON.stringify(v));
const json = (o) => JSON.stringify(o);
const isAnalyst = (t) => t.includes('Ты управляешь исследованием');
const isVerifier = (t) => t.includes('Ты независимый проверяющий');

async function fixture({ models = ['GPT'], analystAnswers = [], verifierAnswers = [], workSchema = null, noJournal = false, verifierJournalSuffix = '' } = {}) {
  const indexedDB = createFakeIndexedDB();
  const store = await createStateStore({ indexedDB });
  const values = new Map(), sent = [], metadata = new Map(), begins = []; let seq = 0, backups = 0, work = 0;
  const storage = { async get(k) { return { [k]: values.get(k) }; }, async set(o) { for (const [k, v] of Object.entries(o)) values.set(k, clone(v)); } };
  const bridge = {
    capture: () => ({ models, errors: [], schema: workSchema || { schemaVersion: 1, origin: 'user', run: { policy: 'manual' },
      steps: [{ ref: 'r1', kind: 'round', models: models.map((name) => ({ name })) }] } }),
    accept: () => ({ ok: true }), roleText: () => '',
    begin({ runId, schema }) { begins.push({ runId, ref: schema.steps[0].task || (schema.steps[0].input === 'none' ? 'single' : 'work') }); }, end() {},
    async send(names, byModel, meta) {
      const out = {};
      if (!noJournal) await meta?.onDispatchPrompts?.(Object.fromEntries(names.map((n) => [n, byModel[n] + (isVerifier(byModel[n]) ? verifierJournalSuffix : '') + ' [[AO-abc123]]'])));
      for (const name of names) {
        const text = byModel[name];
        sent.push({ model: name, text });
        let answer;
        if (isAnalyst(text)) answer = analystAnswers.shift();
        else if (isVerifier(text)) answer = verifierAnswers.shift();
        else answer = 'Work ' + name + ' ' + (++work);
        out[name] = { text: answer, status: 'SUCCESS', answered: true };
      }
      return { byModel: out };
    }
  };
  const gate = createBackupGate({ clock: () => 1000 + backups, metadata: {
    async get(id) { return metadata.get(id) || null; },
    async put(id, rev, v) { if ((metadata.get(id)?.revision || 0) !== rev) return false; metadata.set(id, clone(v)); return true; } },
    backup: { async save(key, { requiredCommitId }) { backups++; return { key, verified: true, packetCommitId: requiredCommitId }; } } });
  const runner = createCircleRunner({ bridge, storage, activeStore: { async createActiveStateStore() { return { store, database: 'test', close() {} }; } },
    controllerApi: { createController }, adapterApi: { createBasicAdapter }, contextApi: context, policyApi,
    createBackup: async () => ({ gate, close() {} }), uuid: () => String(++seq) });
  return { runner, store, indexedDB, sent, begins };
}
module.exports = { fixture, json, isAnalyst, isVerifier, createStateStore, clone };
