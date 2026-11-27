const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('Circle continue after reload: buttons', () => {
  for (const file of ['pipeline_panel.html', 'result_new.html']) {
    test(file + ' has the continue and the two unknown-outcome buttons inside circle-pipeline-controls', () => {
      const html = read(file);
      const block = html.slice(html.indexOf('id="circle-pipeline-controls"'), html.indexOf('</section>', html.indexOf('id="circle-pipeline-controls"')));
      expect(block).toContain('id="circle-resume"');
      expect(block).toMatch(/id="circle-abandon-unknown"[^>]*hidden/);
      expect(block).toMatch(/id="circle-close"[^>]*hidden/);
    });
  }
  const results = read('results.js');
  test('click handlers ask for directory access first, then call the runner', () => {
    expect(results).toContain("document.getElementById('circle-resume')?.addEventListener('click'");
    expect(results).toContain("document.getElementById('circle-abandon-unknown')?.addEventListener('click'");
    expect(results).toContain("document.getElementById('circle-close')?.addEventListener('click'");
    expect(results).toMatch(/const access = mode === 'close' \? null : ensureCircleBackupAccess\(\);/);
    expect(results).toContain("runner.resume(id, options)");
    expect(results).toContain("runner.resolveUnknown(id,");
  });
  test('busy page is refused like a start', () => {
    expect(results).toMatch(/const runCircleRecovery = async \(mode\) => \{\s*if \(circlePageRunner \|\| pipelineRunActive \|\| theCycleHeld\)/);
  });
  test('status shows phase, pause reason and last decision', () => {
    expect(results).toContain('pauseReason: result.pauseReason, lastDecision: result.lastDecision');
  });
});
