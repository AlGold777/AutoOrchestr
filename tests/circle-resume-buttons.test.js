const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('Circle continue after reload: buttons', () => {
  for (const file of ['pipeline_panel.html', 'result_new.html']) {
    test(file + ' has the continue and the two unknown-outcome buttons inside circle-pipeline-controls', () => {
      const html = read(file);
      const block = html.slice(html.indexOf('id="circle-pipeline-controls"'), html.indexOf('</section>', html.indexOf('id="circle-pipeline-controls"')));
      expect(block).toContain('id="circle-resume"');
      expect(block).toContain('id="circle-research-select"');
      expect(block).toContain('id="circle-resume-budget"');
      expect(block).toMatch(/id="circle-abandon-unknown"[^>]*hidden/);
      expect(block).toMatch(/id="circle-close"[^>]*hidden/);
    });
  }
  const results = read('results.js');
  test('click handlers ask for directory access first, then call the runner', () => {
    expect(results).toContain("document.getElementById('circle-resume')?.addEventListener('click'");
    expect(results).toContain("document.getElementById('circle-abandon-unknown')?.addEventListener('click'");
    expect(results).toContain("document.getElementById('circle-close')?.addEventListener('click'");
    expect(results).toMatch(/const access = ensureCircleBackupAccess\(\);\s*let runner = null;/);
    // Closing asks too (it leaves a copy), but does not depend on the answer.
    expect(results).toContain("if (!granted.ok && mode !== 'close') {");
    expect(results).toContain("runner.resume(id, options)");
    expect(results).toContain("runner.resolveUnknown(id,");
  });
  test('saved researches are chosen by the person; the newest is only the fallback', () => {
    expect(results).toContain('circleResearches = await runner.list();');
    expect(results.match(/runner\.latest\(\)/g)).toHaveLength(1);
    expect(results).toContain("if (mode === 'resume' && limit) options.maxCalls = limit;");
    expect(results).toContain('if (wasHidden && !circleControls.hidden) void loadCircleResearches();');
  });
  test('the list shows the creation time in local time', () => {
    const source = results.slice(results.indexOf('const circleLocalTime'), results.indexOf('const refreshCircleResearches'));
    const circleLocalTime = new Function(source + 'return circleLocalTime;')();
    const local = new Date(2026, 10, 27, 19, 50);
    expect(circleLocalTime(local.toISOString())).toBe('2026-11-27 19:50');
    expect(circleLocalTime('')).toBe('');
    expect(results).toContain('${circleLocalTime(row.createdAt)}');
  });
  test('busy page is refused like a start', () => {
    expect(results).toMatch(/const runCircleRecovery = async \(mode\) => \{\s*if \(circlePageRunner \|\| pipelineRunActive \|\| theCycleHeld\)/);
  });
  test('status shows phase, pause reason and last decision', () => {
    expect(results).toContain('pauseReason: result.pauseReason, lastDecision: result.lastDecision');
  });
});
