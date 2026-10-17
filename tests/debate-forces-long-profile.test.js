// Locks: universal stage dispatch forces the LONG generation-wait profile so slow
// participant answers can use the extended Long window instead of Standard.
const fs = require('fs');
const path = require('path');

const RESULTS_SRC = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');

describe('debate forces LONG profile', () => {
  test('runModelBatch sets longGenerationMode true and marks the profile long', () => {
    const fnIdx = RESULTS_SRC.indexOf('const runModelBatch = async');
    expect(fnIdx).toBeGreaterThan(-1);
    // Keep the assertion scoped to runModelBatch while allowing pre-dispatch
    // validation/compaction layers to grow without weakening the contract.
    const window = RESULTS_SRC.slice(fnIdx, fnIdx + 12000);
    expect(window).toContain("lastGenerationWaitProfile = 'long'");
    expect(window).toContain('chrome.storage.local.set({ [LONG_GENERATION_MODE_KEY]: true }');
  });

});
