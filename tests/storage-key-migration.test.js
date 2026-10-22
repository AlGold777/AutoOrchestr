const fs = require('fs');
const path = require('path');

const load = () => {
  const root = {};
  new Function('self', fs.readFileSync(path.join(__dirname, '../shared/storage-key-migration.js'), 'utf8').replace(/\}\)\(typeof self[\s\S]*$/, '})(self);'))(root);
  return root.StorageKeyMigration;
};
const makeStorage = (data) => ({
  get: (keys, cb) => cb(Object.fromEntries(keys.filter((k) => k in data).map((k) => [k, data[k]]))),
  set: (p, cb) => { Object.assign(data, p); cb(); },
  remove: (keys, cb) => { [].concat(keys).forEach((k) => delete data[k]); cb(); }
});

describe('StorageKeyMigration', () => {
  test('copies settings to new keys and drops old ones', async () => {
    const data = { 'llmCodexDebateRun.v1': { a: 1 }, 'llmDisputAutoMode.v1': true, 'llmCodexDebateSelectors.v1': { x: 1 }, 'llmCortexDebateBackgroundExecutor.v1': 1 };
    await load().run(makeStorage(data));
    expect(data).toEqual({ 'aoRunTransport.v1': { a: 1 }, 'aoAutoMode.v1': true });
  });
  test('does not overwrite an existing new key', async () => {
    const data = { 'llmCodexDebateScheme.v1': '3', 'aoSchemeMode.v1': '2' };
    await load().run(makeStorage(data));
    expect(data).toEqual({ 'aoSchemeMode.v1': '2' });
  });
});
