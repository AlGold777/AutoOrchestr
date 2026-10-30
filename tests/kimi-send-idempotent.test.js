/** @jest-environment jsdom */
// L-7: Kimi's Send is idempotent. The in-page click may land after the 1.5 s confirmation window;
// a trusted (CDP) click then must not send the prompt a second time.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'content-scripts/content-kimi.js'), 'utf8');
function section(start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error(`boundaries changed: ${start}`);
  return source.slice(a, b);
}
const block = section('const readComposerText', 'const waitForStableResponse');
const SEND = ['div.send-button-container'];

function load() {
  const trusted = jest.fn(() => Promise.resolve({ ok: true }));
  const context = {
    document,
    console,
    Date,
    setTimeout,
    clearTimeout,
    stopped: false,
    MODEL: 'Kimi',
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    USER_TURN_SELECTOR: '.segment-user',
    SEND_SELECTORS: SEND,
    findFirst: (selectors) => selectors.map((s) => document.querySelector(s)).find(Boolean) || null,
    chrome: {
      runtime: {
        sendMessage: (message, callback) => {
          if (message.type === 'KIMI_TRUSTED_SEND_REQUEST') trusted();
          callback?.({ ok: true });
        }
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(block + '\n;this.api = { sendPrompt };', context);
  return { api: context.api, trusted };
}

afterEach(() => { jest.useRealTimers(); document.body.innerHTML = ''; });

test('a late in-page click that clears the composer prevents the trusted click', async () => {
  jest.useFakeTimers();
  document.body.innerHTML = '<div class="composer">draft</div><div class="send-button-container"></div>';
  const composer = document.querySelector('.composer');
  const { api, trusted } = load();
  // The composer is cleared 2 s after the send, after the 1.5 s confirmation window closed.
  setTimeout(() => { composer.textContent = ''; }, 2000);
  const pending = api.sendPrompt(composer);
  await jest.advanceTimersByTimeAsync(2200);
  await expect(pending).resolves.toBe(true);
  expect(trusted).not.toHaveBeenCalled();
});

test('no sign of the send after the window still requests the trusted click once', async () => {
  jest.useFakeTimers();
  document.body.innerHTML = '<div class="composer">draft</div><div class="send-button-container"></div>';
  const composer = document.querySelector('.composer');
  const { api, trusted } = load();
  const pending = api.sendPrompt(composer);
  // Click window 4 s, then the trusted path waits up to 4 s for its own confirmation.
  await jest.advanceTimersByTimeAsync(8200);
  await expect(pending).resolves.toBe(false);
  expect(trusted).toHaveBeenCalledTimes(1);
});
