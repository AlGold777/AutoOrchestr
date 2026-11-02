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

describe('built-in Default follows the models selected on top', () => {
  test('the sync is skipped only for a Basic pipeline other than the built-in Default', () => {
    expect(read('results.js')).toContain("if (isCustomEnginePipeline() && !isDefaultPipelineName(pipelineStore.active || 'Default')) return false;");
  });
});

describe('scheme sticks under the top bar', () => {
  test('the panel is sticky below the top bar and its container has room to travel', () => {
    const css = read('styles/pipeline.css');
    expect(css).toMatch(/\.pipeline-page \.pipeline-panel\.pipeline-panel-inline:not\(\.is-popout\)\s*\{[^}]*position:\s*sticky[^}]*var\(--pipeline-top-bar-bottom/s);
    expect(css).toMatch(/\.pipeline-page \.control-buttons\s*\{[^}]*min-height:\s*calc\(100dvh/s);
    expect(read('results.js')).toContain("setProperty('--pipeline-top-bar-bottom'");
  });
});

describe('scheme speeds up before it sticks', () => {
  test('the lead is a CSS variable on the panel set from the scroll; the page does not anchor its scroll', () => {
    expect(read('styles/pipeline.css')).toContain('transform: translateY(var(--stick-lead, 0px));');
    expect(read('styles/pipeline.css')).toContain('html:has(body.pipeline-page) { overflow-anchor: none; }');
    expect(read('results.js')).toContain("setProperty('--stick-lead'");
  });

  test('progress curve: starts at the page speed, ends faster, reaches the line early', () => {
    const lead = 160; const share = 0.3; const span = lead * (1 - share); const a = span / lead;
    const shiftAt = (distance) => {
      const u = Math.min(1, (lead - distance) / span);
      return lead * (1 - (a * u + (1 - a) * u * u)) - distance;
    };
    expect(shiftAt(lead)).toBeCloseTo(0, 5);
    expect(shiftAt(lead * share)).toBeCloseTo(-lead * share, 5);
    const top = (distance) => distance + shiftAt(distance);
    expect(top(lead * share)).toBeCloseTo(0, 5);
    expect(top(80) - top(60)).toBeGreaterThan(top(150) - top(130));
  });
});

describe('the Pipelines header is as high as the scheme header', () => {
  test('height comes from a variable set from the scheme header', () => {
    expect(read('styles/pipeline.css')).toMatch(/\.pipeline-panel \.pipeline-list-header\s*\{[^}]*height:\s*var\(--panel-header-height, auto\)/s);
    expect(read('results.js')).toContain("setProperty('--panel-header-height'");
  });
});

describe('the page ends where the scheme stops under the bar', () => {
  test('the space under the scheme container is trimmed by a measured variable', () => {
    expect(read('styles/pipeline.css')).toContain('margin-bottom: calc(-1 * var(--pipeline-tail-trim, 0px));');
    expect(read('results.js')).toContain("setProperty('--pipeline-tail-trim'");
  });
});

describe('the window works as a console of the pipeline', () => {
  test('Run / Pause sits in the header, is shown only in the window and mirrors the main Run button', () => {
    const html = read('pipeline_panel.html');
    const header = html.slice(html.indexOf('class="panel-header"'), html.indexOf('class="pipeline-canvas"'));
    expect(header).toContain('id="pipeline-popout-run-btn"');
    expect(header.indexOf('panel-header-actions')).toBeLessThan(header.indexOf('pipeline-popout-run-btn'));
    expect(header.indexOf('pipeline-popout-run-btn')).toBeLessThan(header.indexOf('pipeline-list-header-actions'));
    const css = read('styles/pipeline.css');
    expect(css).toContain('.pipeline-popout-run-btn { display: none; }');
    expect(css).toMatch(/\.pipeline-panel\.is-popout \.pipeline-popout-run-btn \{[^}]*left: 50%/);
    const js = read('results.js');
    expect(js).toContain("runButton: document.getElementById('pipeline-popout-run-btn')");
    expect(js).toContain("document.getElementById('pipeline-popout-run-btn')?.addEventListener('click'");
  });

  test('card windows and tooltips stay above the window', () => {
    expect(read('styles/pipeline.css')).toContain('body.pipeline-popout-open .modal { z-index: 5100; }');
    expect(read('styles/app-controls.css')).toMatch(/z-index: 6000;\s*\}\s*\.floating-tooltip\.is-visible/);
    expect(read('results.js')).toContain("document.body.classList.add('pipeline-popout-open')");
  });
});
