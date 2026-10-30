/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const source = fs.readFileSync(require.resolve('../content-scripts/content-deepseek'), 'utf8');

test('DeepSeek writes the prompt through the native value setter so React state sees it', async () => {
  const written = [];
  class FakeTextarea {
    get value() { return this._v || ''; }
    set value(v) { this._v = v; } // a plain assignment, which React would not see
  }
  const nativeSet = jest.fn(function (v) { written.push(v); this._v = v; });
  Object.defineProperty(FakeTextarea.prototype, 'value', {
    get() { return this._v || ''; },
    set: nativeSet,
    configurable: true
  });
  const input = Object.create(FakeTextarea.prototype);
  input.focus = jest.fn();
  input.dispatchEvent = jest.fn();
  const slice = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
  const context = {
    console,
    InputEvent: class { constructor(type, init) { Object.assign(this, init, { type }); } },
    Event: class { constructor(type) { this.type = type; } },
    sleep: async () => {}
  };
  vm.createContext(context);
  vm.runInContext([
    'const sleep = async () => {};',
    slice('function readComposerValue', 'function isCaptchaField'),
    slice('async function fallbackDeepseekType', 'async function deepseekHumanType'),
    slice('async function typePrompt', 'async function resolveSendButton'),
    'typePrompt;'
  ].join('\n'), context);
  const typePrompt = vm.runInContext('typePrompt', context);
  await typePrompt(input, 'Задача: проверка');
  expect(nativeSet).toHaveBeenCalledWith('Задача: проверка');
  expect(input.value).toBe('Задача: проверка');
});

test('DeepSeek send confirmation ignores page-wide spinners and loaders', () => {
  const start = source.indexOf('const confirmDeepSeekSend');
  const block = source.slice(start, source.indexOf('await sleep(2000);', start));
  const query = block.match(/document\.querySelector\('([^']+)'\)/);
  expect(query).not.toBeNull();
  expect(query[1]).not.toMatch(/\.loading|\.spinner/);
  expect(query[1]).toBe('[data-role="assistant"] [aria-busy="true"], [data-streaming="true"]');
});
