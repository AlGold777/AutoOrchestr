const fs = require('fs');
const path = require('path');
const Retention = require('../shared/response-viewer-retention');

describe('response viewer content retention', () => {
  const key = (stamp) => `llmResponseViewer.${stamp}-abc`;

  test('keeps the newest keys by their timestamp and names the rest; other keys are never named', () => {
    const keys = [key(300), key(100), 'other.key', key(500), key(200), key(400), 'llmComparatorPipelines'];
    expect(Retention.keysToRemove(keys, 2)).toEqual([key(300), key(200), key(100)]);
    expect(Retention.keysToRemove(keys, 10)).toEqual([]);
    expect(Retention.keysToRemove(keys, 0)).toHaveLength(5);
  });

  test('a key with no timestamp counts as the oldest; a non-list gives nothing', () => {
    expect(Retention.keysToRemove([key(5), 'llmResponseViewer.default'], 1)).toEqual(['llmResponseViewer.default']);
    expect(Retention.keysToRemove(null, 1)).toEqual([]);
  });

  test('the background keeps the content in the session storage, local only as a fallback, and cleans the old local copies at start', () => {
    const router = fs.readFileSync(path.join(__dirname, '..', 'background', 'message-router.js'), 'utf8');
    expect(router).toMatch(/chrome\.storage\.session\.set\(\{ \[key\]: message\.payload \}, \(\) => \{\s*if \(!chrome\.runtime\.lastError\) \{\s*void pruneResponseViewerContent\(\);/);
    expect(router).toContain('await pruneResponseViewerContent({ legacyLocal: true });');
    // It also runs on its own at the start of the service worker, once per browser session, not only in the late maintenance.
    expect(router).toContain("const { responseViewerLegacyCleaned } = await chrome.storage.session.get('responseViewerLegacyCleaned');");
    // The cleanup comes before the other maintenance: those steps fail on a full storage and would skip it.
    expect(router.indexOf('await pruneResponseViewerContent({ legacyLocal: true });')).toBeLessThan(router.indexOf("await CompressedStorage.migrate(['results', 'notes', 'logs']);"));
    const index = fs.readFileSync(path.join(__dirname, '..', 'background', 'index.js'), 'utf8');
    expect(index).toContain("'../shared/response-viewer-retention.js',");
    const page = fs.readFileSync(path.join(__dirname, '..', 'results.js'), 'utf8');
    expect(page).toContain('let viewerStored = false;');
    expect(page).toContain('if (!viewerStored) {');
  });
});
