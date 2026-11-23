// Store version 10 (results.js migrateBasicEnd): a stored Basic schema without `end` gets the default End source explicitly.
// The built-in user_doc has an explicit `end` and revision 3 (disput/pipeline-presets.js).
const H = require('./helpers/results-page-harness');

const STORE_KEY = 'llmComparatorPipelines';

const schemaWithoutEnd = {
  schemaVersion: 1, origin: 'user',
  steps: [
    { ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] },
    { ref: 'r2', kind: 'round', models: [{ name: 'Claude' }], input: 'previous' }
  ]
};
const schemaWithEnd = {
  schemaVersion: 1, origin: 'user',
  end: { from: ['r1'] },
  steps: [
    { ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] },
    { ref: 'r2', kind: 'round', models: [{ name: 'Claude' }], input: 'previous' }
  ]
};
// The last round has no enabled model: the default End is the last round with one (r1).
const schemaLastRoundOff = {
  schemaVersion: 1, origin: 'user',
  steps: [
    { ref: 'r1', kind: 'round', models: [{ name: 'GPT' }] },
    { ref: 'r2', kind: 'round', models: [{ name: 'Claude', enabled: false }], input: 'previous' }
  ]
};
// A legacy (non-Basic) record: no schema, only the protocol. It must stay as it is (profile fields given, so the page adds nothing).
const legacyRecord = {
  version: 3,
  roundCounter: 1,
  protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: ['GPT'], roundLimit: '1', runPolicy: 'auto', profileId: 'UNIVERSAL_STANDARD', profileVersion: '1.0.0' },
  modelStacks: { 'r1-models': { items: [{ name: 'GPT', input: true, send: true, role: null }] } }
};

// A Basic record as recordFromSchema writes it: the schema beside its protocol (a record without protocol is dropped on read).
const basicRecord = (schema) => ({
  version: 3,
  roundCounter: 2,
  protocol: { type: 'universal', presetId: 'CUSTOM', selectedModels: [], roundLimit: '2', runPolicy: 'auto', profileId: 'UNIVERSAL_STANDARD', profileVersion: '1.0.0' },
  modelStacks: {},
  schema: JSON.parse(JSON.stringify(schema))
});

const storeV9 = () => ({
  version: 9,
  pipelines: {
    Plain: basicRecord(schemaWithoutEnd),
    Explicit: basicRecord(schemaWithEnd),
    Off: basicRecord(schemaLastRoundOff),
    Legacy: JSON.parse(JSON.stringify(legacyRecord))
  },
  order: ['Plain', 'Explicit', 'Off', 'Legacy'],
  seeded: [],
  seededRev: {},
  lastSaved: '',
  active: '',
  overrides: { longRoundLimits: {}, profiles: {} },
  draftPlans: {}
});

describe('Basic: store version 10 writes the End source of each stored schema', () => {
  let debug;

  beforeAll(async () => {
    H.renderDebateDom();
    document.body.classList.add('pipeline-page');
    await H.loadResultsScript(storeV9());
    debug = window.__pipelineLifecycleDebug;
  });

  test('the stored list is at version 10 after the first read', async () => {
    const stored = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
    expect(stored.version).toBe(10);
  });

  test('a schema without end gets end.from with the last round with an enabled model', async () => {
    const stored = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
    expect(stored.pipelines.Plain.schema.end).toEqual({ from: ['r2'] });
    expect(stored.pipelines.Off.schema.end).toEqual({ from: ['r1'] });
  });

  test('a schema with end keeps it, and a legacy record is not changed', async () => {
    const stored = (await chrome.storage.local.get(STORE_KEY))[STORE_KEY];
    expect(stored.pipelines.Explicit.schema).toEqual(schemaWithEnd);
    expect(stored.pipelines.Legacy).toEqual(legacyRecord);
    expect('schema' in stored.pipelines.Legacy).toBe(false);
  });

  test('the migrated schemas are valid Basic schemas and the End sources come out right', () => {
    const { pipelines } = debug.normalizePipelineStore(storeV9());
    expect(window.BasicSchema.validate(pipelines.Plain.schema)).toEqual([]);
    expect(window.BasicSchema.endSources(pipelines.Plain.schema)).toEqual([{ step: 'r2' }]);
    expect(window.BasicSchema.endSources(pipelines.Off.schema)).toEqual([{ step: 'r1' }]);
  });

  test('a repeated normalization of a version 10 store changes nothing', () => {
    const once = debug.normalizePipelineStore(storeV9());
    const twice = debug.normalizePipelineStore(JSON.parse(JSON.stringify(once)));
    expect(twice.pipelines).toEqual(once.pipelines);
    expect(twice.pipelines.Plain.schema.end).toEqual({ from: ['r2'] });
  });

  test('a schema with no runnable round gets no end', () => {
    const noRound = {
      version: 9,
      pipelines: { Owner: basicRecord({ schemaVersion: 1, origin: 'user', steps: [{ ref: 'owner:a', kind: 'owner', models: [] }] }) },
      order: ['Owner']
    };
    const { pipelines } = debug.normalizePipelineStore(noRound);
    expect('end' in pipelines.Owner.schema).toBe(false);
  });

  test('the built-in user_doc has an explicit end, revision 3, and validates', () => {
    const presets = window.PipelinePresets;
    expect(presets.BUILTIN_SCHEMA_REVISIONS.user_doc).toBe(3);
    const userDoc = presets.BUILTIN_SCHEMAS.user_doc;
    expect(userDoc.end).toEqual({ from: ['r2'] });
    expect(window.BasicSchema.validate(JSON.parse(JSON.stringify(userDoc)))).toEqual([]);
  });
});
