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

  test('the stylesheet fades the connector arrows out and animates the fade', () => {
    const css = read('styles', 'pipeline.css');
    expect(css).toMatch(/\.pipeline-canvas\.arrows-hidden\s+\.connector-svg\s*\{[^}]*opacity:\s*0/);
    expect(css).toMatch(/\.connector-svg\s*\{[^}]*transition:\s*opacity/);
  });
});
