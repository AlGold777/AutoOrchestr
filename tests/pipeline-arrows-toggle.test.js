const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');

describe('pipeline canvas arrows toggle', () => {
  test('the Arrows button sits in the pipeline header actions, pressed by default and labelled', () => {
    const html = read('pipeline_panel.html');
    const headerStart = html.indexOf('class="pipeline-list-header-actions"');
    expect(headerStart).toBeGreaterThan(-1);
    const headerEnd = html.indexOf('</div>', headerStart);
    const header = html.slice(headerStart, headerEnd);
    const button = header.match(/<button[^>]*id="pipeline-arrows-toggle"[^>]*>/);
    expect(button).not.toBeNull();
    expect(button[0]).toMatch(/aria-pressed="true"/);
    expect(button[0]).toMatch(/aria-label="Стрелки"/);
  });

  test('hiding arrows removes only the artifact lines; lines between blocks stay', () => {
    const css = read('styles', 'pipeline.css');
    expect(css).not.toMatch(/arrows-hidden\s+\.connector-svg/);
    expect(read('styles', 'basic-input-canvas.css')).toMatch(/arrows-hidden\s+\.basic-input-canvas-svg\s*\{[^}]*display:\s*none/);
  });
});
