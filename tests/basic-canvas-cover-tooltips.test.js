/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const results = read('results.js');

describe('Basic canvas: no padded participants in a schema stack', () => {
  test('an incoming Basic schema does not pad every stack with all project models', () => {
    expect(results).not.toMatch(/known\.has\(model\.name\)\) items\.push/);
    expect(results).toMatch(/modelStacks\[`r\$\{round\}-models`\] = \{ items: \[\] \}/);
  });
});

describe('Basic card feed cover deck', () => {
  const PipelineCardCover = (() => {
    // eslint-disable-next-line no-new-func
    new Function('window', 'document', read('results', 'pipeline-card-cover.js'))(window, document);
    return window.PipelineCardCover;
  })();

  const card = (cls) => {
    const el = document.createElement('div');
    el.className = `debate-model-card debate-moderator-card ${cls}`.trim();
    return el;
  };

  test('run lines are neither counted as deck cards nor given a cover slot', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 500 });
    root.appendChild(card('basic-run-line'));
    root.appendChild(card(''));
    root.appendChild(card('basic-run-line'));
    root.appendChild(card(''));
    const cover = PipelineCardCover.create(root);
    cover.refresh();
    // Two answer cards: travel is one step (92% of the 500px height), not three steps as with the run lines counted.
    expect(root.classList.contains('pipeline-cover-host')).toBe(true);
    expect(root.style.getPropertyValue('--pipeline-cover-travel')).toBe(`${500 * 0.92}px`);
    const marked = [...root.children].filter((el) => el.classList.contains('pipeline-cover-card'));
    expect(marked.length).toBe(2);
    expect(marked.some((el) => el.classList.contains('basic-run-line'))).toBe(false);
    // DOM is kept: export relies on the direct children of the feed.
    expect(root.children.length).toBe(4);
    cover.destroy();
    root.remove();
  });

  test('the answer body contains its own paint: copied ChatGPT markup cannot grow the feed', () => {
    const css = read('styles', 'modals-responsive.css');
    const rule = css.match(/\n\.debate-model-card-output \{([^}]*)\}/);
    expect(rule).not.toBeNull();
    expect(rule[1]).toMatch(/overflow: hidden;/);
    expect(rule[1]).toMatch(/contain: paint;/);
    // Expanded card keeps its full height: the containment does not cap the in-flow content.
    expect(css).toMatch(/\.debate-model-card\.is-expanded \.debate-model-card-output \{\s*max-height: none;\s*overflow: visible;/);
    expect(read('styles', 'pipeline-card-cover.css')).toMatch(/\.pipeline-cover-host > \.pipeline-cover-card\.is-expanded \.debate-model-card-output \{\s*flex: 1;\s*min-height: 0;\s*max-height: none;\s*overflow-y: auto;/);
  });

  test('the cover stylesheet hides run lines inside the cover host', () => {
    expect(read('styles', 'pipeline-card-cover.css')).toMatch(/\.pipeline-cover-host > \.basic-run-line:not\(:has\(\.basic-run-line-button\)\) \{ display: none; \}/);
  });
});

describe('Basic canvas tooltips', () => {
  test('a failing description read does not cut the tooltip sync', () => {
    expect(results).toMatch(/const safeRead = \(read, fallback\) => \{ try \{ return read\(\) \?\? fallback; \} catch/);
    expect(results).toMatch(/safeRead\(\(\) => basicDescription\(\), ''\)/);
    expect(results).toMatch(/safeRead\(\(\) => getCustomControls\(\)\.map/);
  });
});
