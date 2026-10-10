const fs = require('fs');
const path = require('path');
const Engine = require('../disput/custom-engine');

const root = path.join(__dirname, '..');
const docsDir = path.join(root, 'docs', 'Pipeline scenarios');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const exists = (file) => fs.existsSync(path.join(root, file));

const codeMap = fs.readFileSync(path.join(docsDir, 'basic-code-map.md'), 'utf8');
const how = fs.readFileSync(path.join(docsDir, 'basic-how-it-works.md'), 'utf8');
const start = fs.readFileSync(path.join(docsDir, 'basic-start-here.md'), 'utf8');
const results = read('results.js');
const engine = read('disput/custom-engine.js');

const section = (text, title) => {
  const start = text.indexOf(`\n## ${title}`);
  if (start < 0) throw new Error(`no section: ${title}`);
  const next = text.slice(start + 3).search(/\n## /);
  return text.slice(start, next < 0 ? undefined : start + 3 + next);
};

// Table rows of a section without the header row and the separator row.
const tableRows = (text) => {
  const lines = text.split('\n').filter((line) => line.startsWith('|'));
  return lines.slice(2).map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
};
const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
const wordIn = (source, token) => new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(source);

const filesRows = tableRows(section(codeMap, 'Файлы Basic'));
const resultsRows = tableRows(section(codeMap, 'results.js: области и функции'));
const testRows = tableRows(section(codeMap, 'Тесты'));

const linkTargets = (text) => [...text.matchAll(/\]\((<[^>]+>|[^)\s]+)\)/g)]
  .map((match) => match[1].replace(/^<|>$/g, ''))
  .filter((target) => !/^(https?:|mailto:|#)/.test(target));

describe('Basic docs stay true to the code', () => {
  test('the code map lists enough files and symbols to be meaningful', () => {
    expect(filesRows.length).toBeGreaterThanOrEqual(8);
    expect(resultsRows.length).toBeGreaterThanOrEqual(8);
  });

  test('every file of the code map exists and every symbol of its row is in that file', () => {
    filesRows.forEach(([cell0, cell1]) => {
      const [file] = ticks(cell0);
      expect(file).toBeDefined();
      expect(exists(file)).toBe(true);
      const source = read(file);
      ticks(cell1).forEach((symbol) => expect({ file, symbol, found: wordIn(source, symbol) }).toEqual({ file, symbol, found: true }));
    });
  });

  test('every symbol of the results.js table is in results.js', () => {
    resultsRows.forEach(([, cell1]) => {
      ticks(cell1).forEach((symbol) => expect({ symbol, found: wordIn(results, symbol) }).toEqual({ symbol, found: true }));
    });
  });

  test('every test file of the code map exists', () => {
    const files = testRows.map(([cell0]) => ticks(cell0)[0]).filter(Boolean);
    expect(files.length).toBeGreaterThanOrEqual(8);
    files.forEach((file) => expect({ file, exists: exists(file) }).toEqual({ file, exists: true }));
  });

  test('the event names of the journal table are the events the code emits, plus owner_answer', () => {
    const journal = [...section(how, 'События журнала и запись о прогоне').matchAll(/^\| `([a-z_]+)` \|/gm)].map((match) => match[1]);
    const emitted = [...engine.matchAll(/emit\('([a-z_]+)'/g)].map((match) => match[1]);
    expect(emitted.length).toBeGreaterThan(0);
    expect(/batchEvent(\?\.)?\('owner_answer'/.test(results)).toBe(true);
    expect([...new Set(journal)].sort()).toEqual([...new Set([...emitted, 'owner_answer'])].sort());
  });

  test('every stop reason and every rejection reason of the engine is described in how-it-works', () => {
    [...Object.keys(Engine.STOP_TEXT), ...Object.keys(Engine.REASON_TEXT)].forEach((key) => {
      expect({ key, found: how.includes(`\`${key}\``) }).toEqual({ key, found: true });
    });
  });

  test('every relative link of the Basic docs and the entry files leads to an existing file', () => {
    const docs = fs.readdirSync(docsDir).filter((name) => /^basic-.*\.md$/.test(name)).map((name) => path.join(docsDir, name));
    const rootFiles = ['AGENTS.md', 'README.md'].map((file) => path.join(root, file));
    const others = ['docs/project-overview.md', 'docs/documentation-map.md'].map((file) => path.join(root, file));
    const broken = [];
    [...docs, ...others, ...rootFiles].forEach((file) => {
      const base = rootFiles.includes(file) ? root : path.dirname(file);
      linkTargets(fs.readFileSync(file, 'utf8')).forEach((target) => {
        const clean = decodeURIComponent(target.split('#')[0]);
        if (clean && !fs.existsSync(path.join(base, clean))) broken.push(`${path.relative(root, file)} -> ${target}`);
      });
    });
    expect(broken).toEqual([]);
  });

  test('the entry points name the Basic documents', () => {
    expect(read('AGENTS.md')).toContain('basic-start-here.md');
    const map = read('docs/documentation-map.md');
    ['basic-start-here.md', 'basic-how-it-works.md', 'basic-code-map.md', 'basic-diagnostics.md'].forEach((name) => expect(map).toContain(name));
  });

  test('every .js name of the start-here vocabulary with a directory is an existing file', () => {
    const names = ticks(section(start, 'Имена: интерфейс и документы → код').replace(/\n/g, ' ')).filter((token) => token.endsWith('.js'));
    expect(names.length).toBeGreaterThan(0);
    names.filter((token) => token.includes('/')).forEach((token) => expect({ token, exists: exists(token) }).toEqual({ token, exists: true }));
  });
});
