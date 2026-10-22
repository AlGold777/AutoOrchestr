#!/usr/bin/env node
/**
 * Copies the browser build of mermaid (the pinned devDependency) into lib/mermaid/ for the results pages.
 * The single-file bundle (dist/mermaid.min.js) is 5.5 MB, over the size budget of lib/; the ESM build loads its
 * diagram types as separate chunks, so the heavy ones that no answer card needs are left out:
 *   - elk-*.mjs (1.6 MB): only the optional ELK layout engine ("layout: elk"); the default layout (dagre) is kept.
 *   - architecture*.mjs / cose-bilkent*.mjs: the "architecture-beta" diagram and its layout engine.
 * A diagram of an omitted kind fails to render; the card then keeps the source as code with a note.
 * Neither build uses eval / new Function (checked), so the extension's default CSP (script-src 'self') is enough.
 * Usage: npm run vendor:mermaid
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'node_modules', 'mermaid');
const target = path.join(root, 'lib', 'mermaid');
const OMIT = /^(?:elk-|architecture|cose-bilkent)/;

const version = JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).version;
fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(path.join(target, 'chunks', 'mermaid.esm.min'), { recursive: true });
fs.copyFileSync(path.join(source, 'dist', 'mermaid.esm.min.mjs'), path.join(target, 'mermaid.esm.min.mjs'));
fs.copyFileSync(path.join(source, 'LICENSE'), path.join(target, 'LICENSE'));
let bytes = fs.statSync(path.join(target, 'mermaid.esm.min.mjs')).size;
let count = 1;
const chunks = path.join(source, 'dist', 'chunks', 'mermaid.esm.min');
fs.readdirSync(chunks).filter((name) => name.endsWith('.mjs') && !OMIT.test(name)).forEach((name) => {
  fs.copyFileSync(path.join(chunks, name), path.join(target, 'chunks', 'mermaid.esm.min', name));
  bytes += fs.statSync(path.join(chunks, name)).size;
  count += 1;
});
fs.writeFileSync(path.join(target, 'VERSION'), `mermaid ${version} (MIT, see LICENSE); copied by scripts/vendor-mermaid.js\n`);
console.log(`[vendor-mermaid] ${version}: ${count} files, ${(bytes / 1048576).toFixed(2)} MB -> lib/mermaid/`);
