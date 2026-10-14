const fs = require('fs');
const path = require('path');
const vm = require('vm');
const jest = { fn(impl = () => {}) { const f = (...args) => { f.mock.calls.push(args); return impl(...args); }; f.mock = { calls: [] }; return f; } };
const testFile = fs.readFileSync(require('path').resolve(__dirname, '../../../tests/tab-manager-session-scope.test.js'), 'utf8');
const source = fs.readFileSync(require('path').resolve(__dirname, '../../../background/tab-manager.js'), 'utf8');
const helper = testFile.slice(testFile.indexOf('function createTabManagerSandbox('), testFile.indexOf("\ndescribe('tab-manager session scoping'"));
const env = { fs, path, vm, jest, __dirname: require('path').resolve(__dirname, '../../../tests'), TAB_MANAGER_PATH: '', TAB_MANAGER_SOURCE: source, console, Promise, Map, Set, Date, Math, Array, Object, Number, String, Boolean, RegExp, JSON, URL, setTimeout, clearTimeout, setInterval, clearInterval };
vm.createContext(env);
vm.runInContext(helper, env);
(async () => {
  // run-1's pending request already bound tab 2001, but the page snapshot has not yet received it (refresh is after batch response).
  const { context } = env.createTabManagerSandbox({ queryTabs: [
    { id: 2002, url: 'https://chatgpt.com/c/run2', windowId: 7, index: 1, status: 'complete' },
    { id: 2003, url: 'https://chatgpt.com/c/foreign', windowId: 7, index: 2, status: 'complete' }
  ] });
  await context.bindParticipantChat('run-1', 'author-A', 'GPT', 2001, { requestId: 'req-old', stageAttemptId: 'attempt-old' });
  // run-2 starts: production startProcess calls pruneParticipantRuns(run-2), deleting run-1's durable binding.
  await context.pruneParticipantRuns('run-2');
  await context.bindParticipantChat('run-2', 'author-B', 'GPT', 2002, { requestId: 'req-new', stageAttemptId: 'attempt-new' });
  await context.setTabBinding('GPT', 2002);
  // Resume run-1 from its real pre-response checkpoint: chatBindings is empty, so binding is omitted. Since 2.81.761 the page marks such a participant strict (it already sent): the request is refused, not attached to tab 2003.
  const result = await context.openParticipantChat('GPT', { runId: 'run-1', participantId: 'author-A', newChat: false, requestId: 'req-retry', stageAttemptId: 'attempt-retry', binding: null, strict: true }, 'resume', []);
  process.stdout.write(JSON.stringify({ result, sent: context.dispatchPromptToTab.mock.calls, remainingBindings: context.participantChatBindingsOf('run-1') }) + '\n');
})().catch((e) => { process.stderr.write(String(e.stack || e) + '\n'); process.exitCode = 1; });
