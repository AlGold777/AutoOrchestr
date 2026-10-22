/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
function setup(update) {
  const c = { setTimeout, clearTimeout, isValidTabId: Number.isInteger,
    jobState: {llms: {}}, self: {markProgrammaticTabFocus: jest.fn()}, chrome: {
      runtime: {lastError: null},
      tabs: {get: jest.fn(), update: jest.fn(update)},
      windows: {update: jest.fn()}
    }};
  vm.createContext(c);
  const source = fs.readFileSync(require.resolve('../background/tab-manager'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('function activateTabForDispatch'), source.indexOf('\nfunction probeReadyContentScript')), c);
  return c;
}
afterEach(() => jest.useRealTimers());

test('a silent window-focus callback cannot skip an activated model', async () => {
  const c = setup((_id, _options, cb) => cb({windowId: 1}));
  expect(await c.activateTabForDispatch(42)).toBe(true);
  expect(c.chrome.tabs.get).not.toHaveBeenCalled();
  expect(c.chrome.tabs.update).toHaveBeenCalledWith(42, {active: true}, expect.any(Function));
  expect(c.chrome.windows.update).toHaveBeenCalledWith(1, {focused: true}, expect.any(Function));
});
test('window-focus failure does not invalidate tab activation', async () => {
  const c = setup((_id, _options, cb) => cb({windowId: 1}));
  c.chrome.windows.update.mockImplementation(() => {throw new Error('Window unavailable');});
  expect(await c.activateTabForDispatch(42)).toBe(true);
});
test('silent activation releases ownership; late completion cannot refocus its window', async () => {
  jest.useFakeTimers();
  let late;
  const c = setup((_id, _options, cb) => {late = cb;});
  const focused = c.activateTabForDispatch(42);
  await jest.advanceTimersByTimeAsync(1500);
  expect(await focused).toBe(false);
  late({windowId: 1});
  expect(c.chrome.windows.update).not.toHaveBeenCalled();
  expect(c.chrome.tabs.update).toHaveBeenCalledTimes(1);
});
test('activation errors still prevent sending into an unavailable tab', async () => {
  const c = setup();
  c.chrome.tabs.update.mockImplementation((_id, _options, cb) => {
    c.chrome.runtime.lastError = {message: 'No tab'};
    cb();
    c.chrome.runtime.lastError = null;
  });
  expect(await c.activateTabForDispatch(42)).toBe(false);
  expect(c.chrome.windows.update).not.toHaveBeenCalled();
});

test('first-pass activation timeout is uncertainty, not a tab error', async () => {
  jest.useFakeTimers();
  let late;
  const c = setup((_id, _options, cb) => {late = cb;});
  const result = c.activateTabForDispatch(42, 'round1_simple', {allowUnconfirmed:true});
  await jest.advanceTimersByTimeAsync(1500);
  expect(await result).toBe('unconfirmed');
  late({windowId:1});
  expect(c.chrome.windows.update).not.toHaveBeenCalled();
});
