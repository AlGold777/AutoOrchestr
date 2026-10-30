const fs = require('fs');
const path = require('path');
const vm = require('vm');

// L-16 / C10: [data-testid="chat-loader"] is history loading, not a generation end marker.
// It must not return in any endGenerationMarkers: source configs, JSON and JS bundles,
// and the built dist files that scripts/build-bundles.js and build-content-bundle.js produce.
const ROOT = path.join(__dirname, '..');
const FORBIDDEN = 'chat-loader';

const readRel = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

function collectMarkerArrays(node, found = []) {
  if (Array.isArray(node)) {
    node.forEach((item) => collectMarkerArrays(item, found));
  } else if (node && typeof node === 'object') {
    for (const [key, value] of Object.entries(node)) {
      if (key === 'endGenerationMarkers' && Array.isArray(value)) found.push(value);
      else collectMarkerArrays(value, found);
    }
  }
  return found;
}

// Text form: returns the source of every `endGenerationMarkers: [ ... ]` literal,
// matching brackets so that attribute selectors such as [data-testid="x"] do not cut it short.
function markerLiterals(text) {
  const blocks = [];
  const re = /endGenerationMarkers\s*:\s*\[/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const start = match.index + match[0].length - 1;
    let depth = 0;
    for (let i = start; i < text.length; i += 1) {
      if (text[i] === '[') depth += 1;
      if (text[i] === ']') {
        depth -= 1;
        if (depth === 0) {
          blocks.push(text.slice(start, i + 1));
          break;
        }
      }
    }
  }
  return blocks;
}

function loadSourceRegistry(rel) {
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readRel(rel), sandbox, { filename: rel });
  return sandbox.SelectorConfigRegistry || {};
}

describe('L-16: chat-loader is not an endGenerationMarkers entry for any provider', () => {
  const sourceFiles = fs.readdirSync(path.join(ROOT, 'selectors'))
    .filter((name) => name.endsWith('.config.js'))
    .map((name) => `selectors/${name}`);

  test('every provider source config is loaded and has no chat-loader marker', () => {
    expect(sourceFiles.length).toBeGreaterThanOrEqual(10);
    for (const rel of sourceFiles) {
      const registry = loadSourceRegistry(rel);
      const providers = Object.keys(registry);
      expect(providers.length).toBeGreaterThan(0);
      for (const provider of providers) {
        const markers = collectMarkerArrays(registry[provider]);
        expect(markers.length).toBeGreaterThan(0);
        expect(JSON.stringify(markers)).not.toContain(FORBIDDEN);
      }
    }
  });

  test('selectors/config-bundle.json has no chat-loader marker for any provider', () => {
    const bundle = JSON.parse(readRel('selectors/config-bundle.json'));
    const markers = collectMarkerArrays(bundle);
    expect(markers.length).toBeGreaterThan(0);
    expect(JSON.stringify(markers)).not.toContain(FORBIDDEN);
  });

  test('bundle and built dist files contain no chat-loader endGenerationMarkers literal', () => {
    const textFiles = [
      'selectors/config-bundle.js',
      ...fs.readdirSync(path.join(ROOT, 'dist'))
        .filter((name) => name.endsWith('-adapter.js'))
        .map((name) => `dist/${name}`),
      ...fs.readdirSync(path.join(ROOT, 'dist', 'content-bundles'))
        .filter((name) => name.endsWith('.bundle.js'))
        .map((name) => `dist/content-bundles/${name}`)
    ];
    let literalsSeen = 0;
    for (const rel of textFiles) {
      const literals = markerLiterals(readRel(rel));
      literalsSeen += literals.length;
      for (const literal of literals) {
        expect({ file: rel, literal: literal.includes(FORBIDDEN) }).toEqual({ file: rel, literal: false });
      }
    }
    expect(literalsSeen).toBeGreaterThan(0);
  });
});
