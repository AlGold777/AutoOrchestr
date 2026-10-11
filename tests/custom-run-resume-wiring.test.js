const fs = require('fs');
const path = require('path');

// The page (results.js) passes the record's callbacks and the saved state to the engine. These checks read the wiring:
// the page path itself (windows, transport) is verified on the page, not here.
const results = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('Basic page binds the engine to the run record (8.2, 8.3)', () => {
  test('the texts go to the record: putText is record.put, getText reads record.texts', () => {
    expect(results).toContain('putText: (value) => record.put(value),');
    expect(results).toContain('getText: (ref) => (ref && record.texts[ref] !== undefined ? record.texts[ref] : undefined)');
  });

  test('the checkpoint writes the registry and the snapshot, and waits for the write (a failed write stops the run)', () => {
    expect(results).toContain('...(record && customRunStore ? { checkpoint: checkpointRecord } : {}),');
    expect(results).toMatch(/const checkpointRecord = \(state\) => \{[\s\S]*?setArtifacts\(record, state\.artifacts\);[\s\S]*?setSnapshot\(record[\s\S]*?return writeRecord\(\);\s*\};/);
  });

  test('writes of the record go one after another, debounced ones too', () => {
    expect(results).toMatch(/const writeRecord = \(\) => \{\s*const next = recordWrites\.then\(\(\) => customRunStore\.save\(record\)\);/);
    expect(results).toContain("const write = () => writeRecord().catch((error) => console.warn('[RESULTS] Custom run record not saved', error));");
  });

  test('«Продолжить прогон» takes the latest record only when it has a saved state, and goes on with its own schema and state', () => {
    expect(results).toContain('if (!window.CustomRunRecord.canResume(latest)) {');
    expect(results).toContain('const builtFromRecord = (record) => {');
    expect(results).toContain('steps: window.BasicSchema.assemble(schema, { roleText: customRoleText })');
    expect(results).toContain('...(resumeRecord ? { resume: { ...resumeRecord.snapshot, artifacts: resumeRecord.artifacts } } : {}),');
    expect(results).toContain('pipelineRunId: resumeRecord ? resumeRecord.runId : makePipelineRunId(),');
    expect(results).toContain('resumeCustomFromPage,');
  });

  test('«Продолжить прогон» is a button of the panel and goes on from the latest record through resumeCustomFromPage', () => {
    const panel = fs.readFileSync(path.join(__dirname, '..', 'pipeline_panel.html'), 'utf8');
    expect(panel).toContain('id="pipeline-resume-btn"');
    expect(results).toContain("document.getElementById('pipeline-resume-btn')?.addEventListener('click', () => { void resumeCustomFromPage(); });");
  });

  test('the run takes the limit of the schema, and the decision window offers «Продолжить» only where the engine allows it', () => {
    expect(results).toContain('runMaxWords: built.run.maxWords,');
    expect(results).toMatch(/const canContinue = choices\.includes\('continue'\);[\s\S]*?confirmText: canContinue \? 'Продолжить' : 'Пропустить шаг'/);
  });

  test('the owner answer, the route choice and the unknown request are asked in windows (A06), no guessed answer is passed', () => {
    expect(results).toContain('provideOwnerResult: ({ stepRef, task, reason, detail }) => askChoiceDialog({');
    expect(results).toContain("chooseRoute: ({ stepRef, choices, reason }) => {");
    expect(results).toContain("resolveUnknown: ({ stepRef, items }) => askChoiceDialog({");
    expect(results).toContain("const askChoiceDialog = (options) => {");
  });
});
