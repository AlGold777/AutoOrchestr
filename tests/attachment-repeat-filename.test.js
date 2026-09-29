/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/attachment-handler.js'), 'utf8');

function setup(text, onDispatch = () => {}) {
  const body = { innerText: text };
  const c = {
    Date, setTimeout, console,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    File: class { constructor(parts, name) { this.name = name; } },
    CustomEvent: class { constructor(type, init) { this.detail = init.detail; } },
    ContentUtils: { ensureMainWorldBridge: async () => true, getMainBridgeToken: () => 'test', reportDispatchStage() {} },
    chrome: { runtime: { sendMessage() {} } },
    document: { body, querySelectorAll: () => [], querySelector: () => null },
    dispatchEvent: event => onDispatch(body, event.detail.mode, event.detail)
  };
  c.window = c; c.self = c;
  vm.runInNewContext(source, c);
  return c;
}
const file = name => ({ name, base64: 'data:text/plain;base64,eA==' });
const options = { timeoutMs: 1000, settleMs: 100, pollMs: 50 };
beforeEach(() => jest.useFakeTimers().setSystemTime(1000));
afterEach(() => jest.useRealTimers());

test('an old filename alone does not prove a new upload', async () => {
  const c = setup('old answer evidence.txt');
  const pending = c.AttachmentHandler.attach('DeepSeek', [file('evidence.txt')], options);
  await jest.advanceTimersByTimeAsync(5000);
  expect((await pending).success).toBe(false);
});

test('the same filename can be attached again without requiring another duplicate', async () => {
  let dispatches = 0;
  const c = setup('old answer evidence.txt', body => {
    dispatches++;
    body.innerText += '\nnew chip evidence.txt';
  });
  const pending = c.AttachmentHandler.attach('DeepSeek', [file('evidence.txt')], options);
  await jest.advanceTimersByTimeAsync(1000);
  expect((await pending).success).toBe(true);
  expect(dispatches).toBe(1);
});

test('two copies of one filename cannot stand in for a different missing file', async () => {
  const c = setup('', body => { body.innerText = 'a.txt a.txt'; });
  const pending = c.AttachmentHandler.attach('DeepSeek', [file('a.txt'), file('b.txt')], options);
  await jest.advanceTimersByTimeAsync(5000);
  expect((await pending).success).toBe(false);
});

test('passes every attachment to the provider when the batch is larger than five files', async () => {
  let deliveredCount = 0;
  const files = Array.from({ length: 8 }, (_, index) => file(`evidence-${index + 1}.txt`));
  const c = setup('', (body, _mode, detail) => {
    deliveredCount = detail.attachments.length;
    body.innerText = detail.attachments.map(item => item.name).join(' ');
  });
  const pending = c.AttachmentHandler.attach('DeepSeek', files, {
    timeoutMs: 1000,
    settleMs: 100,
    pollMs: 25
  });
  await jest.advanceTimersByTimeAsync(10000);
  const result = await pending;
  expect(deliveredCount).toBe(8);
  expect(result).toEqual(expect.objectContaining({ success: true, uploadedCount: 8 }));
});

test('a filename arriving between vectors is still compared to the original baseline', async () => {
  const c = setup('');
  // The first vector's last poll precedes its deadline at 5200. The file
  // arrives at that deadline, before the fallback captures/uses its baseline.
  setTimeout(() => { c.document.body.innerText = 'evidence.txt'; }, 4200);
  const pending = c.AttachmentHandler.attach('DeepSeek', [file('evidence.txt')], {
    timeoutMs: 5000, settleMs: 100, pollMs: 50
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect((await pending).success).toBe(true);
});
