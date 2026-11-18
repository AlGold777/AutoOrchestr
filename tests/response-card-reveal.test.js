const fs = require('fs');
const path = require('path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('Response card reveal on the main page', () => {
  const css = read('styles/response-card-reveal.css');

  test('cards stay in normal flow: no sticky, fixed or absolute pinning', () => {
    expect(css).not.toMatch(/position:\s*(sticky|fixed|absolute)/);
  });

  test('scroll-driven reveal is guarded by browser support and reduced motion', () => {
    expect(css).toMatch(/@supports \(animation-timeline: view\(\)\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\)/);
    expect(css).toMatch(/animation-timeline: view\(\);/);
  });

  test('main page loads the reveal stylesheet and no longer the pinned deck', () => {
    const html = read('result_new.html');
    expect(html).toContain('href="styles/response-card-reveal.css"');
    expect(html).not.toContain('response-card-cover');
    const results = read('results.js');
    expect(results).not.toContain('ResultsResponseCardCover');
    expect(results).not.toContain('responseCardCover');
  });
});
