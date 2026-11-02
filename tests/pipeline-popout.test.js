const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('scheme in its own window', () => {
  test('the button stands in the panel header, right after «Вставить схему»', () => {
    const html = read('pipeline_panel.html');
    const profile = html.indexOf('id="pipeline-profile-btn"');
    const popout = html.indexOf('id="pipeline-popout-btn"');
    expect(profile).toBeGreaterThan(-1);
    expect(popout).toBeGreaterThan(profile);
    expect(html.slice(profile, popout).match(/<button/g).length).toBe(1);
    expect(html.indexOf('</div>', profile)).toBeGreaterThan(popout);
    expect(html).toMatch(/<button[^>]*id="pipeline-popout-btn"[^>]*aria-label="Схема во весь экран"/);
  });

  test('the window is at most 80% of the screen wide and high; the canvas keeps its header on top', () => {
    const css = read('styles', 'pipeline.css');
    expect(css).toMatch(/\.pipeline-panel\.is-popout\s*\{[^}]*max-width:\s*80vw[^}]*max-height:\s*80vh/s);
    expect(css).toMatch(/\.pipeline-panel\.is-popout \.pipeline-list\s*\{\s*display:\s*none/);
    expect(css).toMatch(/\.pipeline-canvas \.stage-header-row[^{]*\{[^}]*position:\s*sticky/s);
  });

  test('the round row follows the page scroll through a shift variable, ', () => {
    expect(read('styles', 'pipeline.css')).toContain('translateY(var(--round-row-pin, 0))');
    expect(read('results.js')).toContain("setProperty('--round-row-pin'");
  });

  test('the page code toggles the window by the button, the backdrop and Escape', () => {
    const js = read('results.js');
    expect(js).toContain("document.getElementById('pipeline-popout-btn')");
    expect(js).toContain("pipelinePanel.classList.add('is-popout')");
    expect(js).toMatch(/event\.key === 'Escape' && pipelinePanel\?\.classList\.contains\('is-popout'\)/);
  });

  test('the User block shows a status indicator, not a text dot', () => {
    const js = read('results.js');
    expect(js).toContain("line('indicator'");
    expect(js).not.toContain("line('●'");
  });
});

describe('no scrollbars on the canvas and in the round cards', () => {
  test('both are hidden by CSS', () => {
    const css = read('styles', 'pipeline.css');
    expect(css).toMatch(/\.pipeline-canvas,[^{]*\.pipeline-stage-dialog[^{]*\{\s*scrollbar-width:\s*none/s);
    expect(css).toMatch(/\.pipeline-canvas::-webkit-scrollbar[^{]*\{\s*display:\s*none/s);
  });
});
