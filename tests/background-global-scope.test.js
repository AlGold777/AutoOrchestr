/** @jest-environment node */
// job-orchestrator.js wraps its whole body in `if (!self.__JOB_ORCHESTRATOR_INITIALIZED__) {
// (function initJobOrchestrator() { 'use strict'; … })(); }`. Its declarations are local to
// that function: another background file can only reach what is exported on `self`.
// A bare reference from another file is a ReferenceError at runtime, or a `typeof` guard
// that silently skips the feature (report 7: "bottom_nudge_skipped: no_nudge_function").
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');

const dir = path.join(__dirname, '..', 'background');
const read = (file) => fs.readFileSync(path.join(dir, file), 'utf8');

function blockScopedNames() {
  const src = read('job-orchestrator.js');
  const ast = acorn.parse(src, { ecmaVersion: 'latest' });
  const wrapper = ast.body.find((node) => node.type === 'IfStatement').consequent.body;
  const iife = wrapper.find((node) => node.type === 'ExpressionStatement' && node.expression.type === 'CallExpression');
  const block = iife.expression.callee.body.body;
  const declared = new Set();
  block.forEach((node) => {
    if (node.type === 'FunctionDeclaration') declared.add(node.id.name);
    if (node.type === 'VariableDeclaration') node.declarations.forEach((d) => d.id.type === 'Identifier' && declared.add(d.id.name));
  });
  const exported = new Set([...src.matchAll(/self\.(\w+)\s*=\s*\w+/g)].map((m) => m[1]));
  return [...declared].filter((name) => !exported.has(name));
}

function bareReferences(hidden, files) {
  const out = [];
  files.forEach((file) => {
    const src = read(file);
    const own = new Set([...src.matchAll(/(?:function\s+|const\s+|let\s+|var\s+)(\w+)/g)].map((m) => m[1]));
    const lines = src.split('\n');
    hidden.forEach((name) => {
      if (own.has(name)) return;
      const re = new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`, 'g');
      let match;
      while ((match = re.exec(src))) {
        const line = src.slice(0, match.index).split('\n').length;
        if (/^\s*\/\//.test(lines[line - 1])) continue;
        out.push(`${file}:${line} ${name}`);
      }
    });
  });
  return out;
}

describe('background global scope', () => {
  test('the analyzer sees the orchestrator declarations', () => {
    const hidden = blockScopedNames();
    expect(hidden.length).toBeGreaterThan(100);
    expect(hidden).toContain('isFinalizedEntry');
    expect(hidden).not.toContain('handleLLMResponse');
  });

  test('no other background file references a name hidden inside the job-orchestrator block', () => {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') && f !== 'job-orchestrator.js');
    expect(bareReferences(blockScopedNames(), files)).toEqual([]);
  });

  test('the loaded service worker exposes what the other files call', () => {
    const deep = () => new Proxy(function () {}, {
      get: (t, key) => (key === 'then' ? undefined : (key === Symbol.toPrimitive ? () => '' : deep())),
      apply: () => deep(),
      construct: () => deep()
    });
    const noop = () => {};
    const ctx = {
      AbortController, Blob, atob, btoa, queueMicrotask, performance, URL, TextEncoder, TextDecoder, structuredClone,
      crypto: require('crypto').webcrypto,
      console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
      setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
      fetch: async () => ({ ok: false, json: async () => ({}) })
    };
    ctx.self = ctx;
    ctx.globalThis = ctx;
    ctx.chrome = deep();
    const errors = [];
    ctx.importScripts = (...files) => files.forEach((file) => {
      const full = path.join(dir, file);
      try { vm.runInContext(fs.readFileSync(full, 'utf8'), ctx, { filename: full }); } catch (err) { errors.push(`${file}: ${err.message}`); }
    });
    vm.createContext(ctx);
    vm.runInContext(read('index.js'), ctx, { filename: 'index.js' });
    expect(errors).toEqual([]);
    [
      'runAutomaticGetItForModel', 'resolveBoundTabIdForOrchestrator', 'resolvePromptForDispatch', 'handleLLMResponse',
      'handleManualResponsePing', 'reportDispatchPhase', 'commitIncompleteAnswer', 'isTerminalRouterEntry',
      'sendMessageToResultsTab', 'openOrFocusResultsTab'
    ].forEach((name) => {
      const reachable = vm.runInContext(`typeof self.${name} === 'function' || typeof ${name} === 'function'`, ctx);
      expect([name, reachable]).toEqual([name, true]);
    });
  });
});
