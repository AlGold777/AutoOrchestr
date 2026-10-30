const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '../../..');
const dir = path.join(repo, 'background');
const fallback = () => new Proxy(function () {}, { get: (t, k) => k === 'then' ? undefined : (k === Symbol.toPrimitive ? () => '' : fallback()), apply: () => fallback(), construct: () => fallback() });
const api = (target = {}) => new Proxy(target, { get: (t, k) => k in t ? t[k] : fallback(), set: (t, k, v) => (t[k] = v, true) });
const noop = () => {};
const tab = { id: 2001, url: 'https://chatgpt.com/c/participant', status: 'complete' };
const ctx = {
  AbortController, Blob, atob, btoa, queueMicrotask, performance, URL, TextEncoder, TextDecoder, structuredClone,
  crypto: require('crypto').webcrypto,
  console: { log: noop, warn: noop, error: noop, info: noop, debug: noop },
  setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  fetch: async () => ({ ok: false, json: async () => ({}) })
};
ctx.self = ctx; ctx.globalThis = ctx;
ctx.chrome = api({
  storage: api({ local: api({ get: (key, cb) => cb({}), set: () => Promise.resolve(), remove: (key, cb) => cb?.() }) }),
  runtime: api({ lastError: null, getURL: file => `chrome-extension://test/${file}` }),
  tabs: api({ get: (_id, cb) => cb(tab), query: (_query, cb) => cb([tab]) }),
  scripting: api({ executeScript: async () => [{ result: { ok: true, text: 'old assistant answer' } }] })
});
const loadErrors = [];
ctx.importScripts = (...files) => files.forEach(file => {
  try { vm.runInContext(fs.readFileSync(path.join(dir, file), 'utf8'), ctx, { filename: file }); }
  catch (e) { loadErrors.push(`${file}: ${e.message}`); }
});
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'index.js'), 'utf8'), ctx, { filename: 'index.js' });
(async () => {
  await ctx.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'new-request', stageAttemptId: 'attempt-2' });
  const result = await ctx.checkParticipantAnswer({ llmName: 'GPT', runId: 'run-1', participantId: 'author-A', transportRequestId: 'new-request', tabId: 2001, excludeText: '' });
  process.stdout.write(JSON.stringify({ loadErrors, extractorVisibleToTabManager: vm.runInContext('typeof extractLatestAssistantSnapshotInPage', ctx), result }) + '\n');
})().catch(e => { process.stderr.write(String(e.stack || e) + '\n'); process.exitCode = 1; });
