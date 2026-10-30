const fs = require('fs');
const path = require('path');

const CORE = fs.readFileSync(path.join(__dirname, '../content-scripts/pragmatist-core.js'), 'utf8');
const CONTENT_UTILS = fs.readFileSync(path.join(__dirname, '../content-scripts/content-utils.js'), 'utf8');

describe('legacy STOP_ALL storage delivery', () => {
  let originalChrome;
  let originalWindowChrome;
  let storageListeners;

  beforeEach(() => {
    originalChrome = global.chrome;
    originalWindowChrome = window.chrome;
    storageListeners = [];
    const chromeMock = {
      runtime: {
        id: 'test-extension',
        getURL: (file) => `chrome-extension://test/${file}`,
        sendMessage: jest.fn((_message, callback) => {
          callback?.();
          return Promise.resolve({});
        }),
        onMessage: {
          addListener: jest.fn(),
          removeListener: jest.fn()
        }
      },
      storage: {
        local: {
          get: jest.fn(() => Promise.resolve({})),
          set: jest.fn(() => Promise.resolve())
        },
        onChanged: {
          addListener(listener) { storageListeners.push(listener); },
          removeListener(listener) {
            storageListeners = storageListeners.filter((candidate) => candidate !== listener);
          }
        }
      }
    };
    global.chrome = chromeMock;
    window.chrome = chromeMock;
    delete window.ContentUtils;
    window.eval(CONTENT_UTILS);
    delete window.PragmatistCore;
    window.eval(CORE);
  });

  afterEach(() => {
    delete window.ContentUtils;
    delete window.PragmatistCore;
    global.chrome = originalChrome;
    window.chrome = originalWindowChrome;
  });

  test('ignores an old session or dispatch but accepts matching and untagged legacy commands', () => {
    const onStopAll = jest.fn();
    const listener = new window.PragmatistCore.BroadcastListener(onStopAll);
    listener.setPlatform('chatgpt');
    listener.start();
    const deliver = (command) => {
      storageListeners.forEach((handler) => handler({ global_command: { newValue: command } }, 'local'));
    };
    const baseCommand = { action: 'STOP_ALL', timestamp: Date.now(), platforms: ['chatgpt'] };

    // Tagged storage Stop is ignored until this page has recorded the active
    // request identities, preventing delayed persistence from stopping a new run.
    deliver({ ...baseCommand, runSessionId: 'run-2', activeDispatchIds: ['dispatch-2'] });
    expect(onStopAll).not.toHaveBeenCalled();

    window.ContentUtils.storeDispatchMeta({ runSessionId: 'run-2', dispatchId: 'dispatch-2' });
    deliver({ ...baseCommand, runSessionId: 'run-1', activeDispatchIds: ['dispatch-1'] });
    deliver({ ...baseCommand, runSessionId: 'run-2', activeDispatchIds: ['dispatch-1'] });
    expect(onStopAll).not.toHaveBeenCalled();

    deliver({ ...baseCommand, runSessionId: 'run-2', activeDispatchIds: ['dispatch-2'] });
    expect(onStopAll).toHaveBeenCalledTimes(1);

    // Commands written before correlation fields existed retain their behavior.
    deliver(baseCommand);
    expect(onStopAll).toHaveBeenCalledTimes(2);
  });
});
