/** @jest-environment node */
const fs = require('fs');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const source = fs.readFileSync(require.resolve('../content-scripts/attachment-handler.js'), 'utf8');

const png = (name) => ({
  name,
  type: 'image/png',
  base64: 'data:image/png;base64,eA=='
});

function setup({ initialImages = [], onDispatch = () => {}, runSessionId = 'run-1' } = {}) {
  const images = initialImages.slice();
  const body = { innerText: '' };
  const record = (mode) => onDispatch(images, { mode });
  const target = {
    focus() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 30 }),
    dispatchEvent(event) {
      if (event.type === 'drop' || event.type === 'paste') record(event.type);
      return true;
    }
  };
  const document = {
    body,
    querySelector(selector) {
      return selector.startsWith('input[type="file"]') ? null : target;
    },
    querySelectorAll(selector) {
      if (selector === '*') return [];
      if (selector === 'img[alt]' || selector === '[alt],[aria-label],[title],[data-testid],[data-test-id]') return images;
      if (selector === '[aria-label],[title],[data-testid],[data-test-id]') {
        return images.filter(image => image.ariaLabel || image.title || image.testId || image.testIdAlt);
      }
      if (selector === '.attachment-match') {
        return images.flatMap(image => Array.from({ length: image.matches || 0 }, () => ({})));
      }
      if (selector === 'input[type="file"]') return [];
      return [];
    }
  };
  const c = {
    Date, setTimeout, console, document,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    File: class { constructor(parts, name) { this.name = name; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    DataTransfer: class {
      constructor() { this.files = []; this.items = { add: file => this.files.push(file), length: 0 }; }
    },
    Event: class {},
    DragEvent: class { constructor(type) { this.type = type; } },
    ContentUtils: {
      ensureMainWorldBridge: async () => true,
      getMainBridgeToken: () => 'test',
      ensureDispatchMeta: () => ({ runSessionId }),
      reportDispatchStage() {}
    },
    chrome: { runtime: { sendMessage() {} } },
    dispatchEvent: event => record(event.detail.mode)
  };
  c.window = c;
  c.self = c;
  vm.runInNewContext(source, c);
  return { c, images };
}

const image = (alt, matches = 3, extra = {}) => ({
  alt,
  matches,
  getAttribute(name) {
    return name === 'alt' ? this.alt
      : name === 'title' ? this.title || null
        : name === 'aria-label' ? this.ariaLabel || null
          : name === 'data-testid' ? this.testId || null
            : name === 'data-test-id' ? this.testIdAlt || null
              : null;
  },
  ...extra
});
const config = {
  strategies: ['drop'],
  confirmSelectors: ['.attachment-match'],
  timeoutMs: 1000,
  settleMs: 0,
  pollMs: 25
};

beforeEach(() => jest.useFakeTimers().setSystemTime(1000));
afterEach(() => jest.useRealTimers());

test('two PNG attachment names found only in img alt confirm once', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    images.push(image(names[0]), image(names[1]));
  } });
  const pending = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual(expect.objectContaining({ success: true, uploadedCount: 2 }));
  expect(dispatches).toBe(1);
});

test('real Qwen image preview markup confirms two PNGs without filename text nodes', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { document } = dom.window;
  let dispatches = 0;
  const addPreview = name => {
    const card = document.createElement('div');
    card.className = 'vision-item-content';
    const img = document.createElement('img');
    img.className = 'vision-item-image';
    img.alt = name;
    img.src = 'blob:local-preview';
    card.append(img);
    const remove = document.createElement('button');
    remove.setAttribute('aria-label', 'Удалить файл');
    document.body.append(card, remove);
  };
  const c = {
    Date, setTimeout, console, document,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    File: class { constructor(parts, name) { this.name = name; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    ContentUtils: {
      ensureMainWorldBridge: async () => true,
      getMainBridgeToken: () => 'test',
      ensureDispatchMeta: () => ({ runSessionId: 'qwen-dom-run' }),
      reportDispatchStage() {}
    },
    chrome: { runtime: { sendMessage() {} } },
    dispatchEvent(event) {
      dispatches += 1;
      names.forEach(addPreview);
    }
  };
  c.window = c;
  c.self = c;
  vm.runInNewContext(source, c);
  expect(document.body.textContent).toBe('');
  const pending = c.AttachmentHandler.attach('Qwen', names.map(png), {
    ...config,
    confirmSelectors: ['.vision-item-image', 'button[aria-label="Удалить файл"]']
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual(expect.objectContaining({ success: true, uploadedCount: 2 }));
  expect(document.querySelectorAll('.vision-item-content > img.vision-item-image')).toHaveLength(2);
  expect(document.querySelectorAll('button[aria-label="Удалить файл"]')).toHaveLength(2);
  expect(dispatches).toBe(1);
  dom.window.close();
});

test('two separate image elements count two files with the same filename', async () => {
  const name = 'Снимок экрана 2026-10-18.png';
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    images.push(image(name), image(name));
  } });
  const pending = c.AttachmentHandler.attach('Perplexity', [png(name), png(name)], config);
  await jest.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual(expect.objectContaining({ success: true, uploadedCount: 2 }));
  expect(dispatches).toBe(1);
});

test('one image with the same name in alt and title counts once, not as two files', async () => {
  const name = 'Снимок экрана 2026-10-18.png';
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    images.push(image(name, 9, { title: name }));
  } });
  const pending = c.AttachmentHandler.attach('DeepSeek', [png(name), png(name)], config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await pending).success).toBe(false);
  expect(dispatches).toBe(1);
});

test('nested preview title plus img alt remain one occurrence for duplicate-name files', async () => {
  const name = 'Снимок экрана 2026-10-18.png';
  const dom = new JSDOM('<!doctype html><html><body></body></html>');
  const { document } = dom.window;
  let dispatches = 0;
  const c = {
    Date, setTimeout, console, document,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    File: class { constructor(parts, fileName) { this.name = fileName; } },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    ContentUtils: {
      ensureMainWorldBridge: async () => true,
      getMainBridgeToken: () => 'test',
      ensureDispatchMeta: () => ({ runSessionId: 'qwen-nested-run' }),
      reportDispatchStage() {}
    },
    chrome: { runtime: { sendMessage() {} } },
    dispatchEvent() {
      dispatches += 1;
      const card = document.createElement('div');
      card.className = 'vision-item-content';
      card.title = name;
      const img = document.createElement('img');
      img.className = 'vision-item-image';
      img.alt = name;
      img.src = 'blob:local-preview';
      card.append(img);
      const remove = document.createElement('button');
      remove.setAttribute('aria-label', 'Удалить файл');
      document.body.append(card, remove);
    }
  };
  c.window = c;
  c.self = c;
  vm.runInNewContext(source, c);
  const pending = c.AttachmentHandler.attach('Qwen', [png(name), png(name)], {
    ...config,
    strategies: ['drop', 'paste', 'input'],
    confirmSelectors: ['.vision-item-image', 'button[aria-label="Удалить файл"]']
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect((await pending).success).toBe(false);
  expect(document.querySelectorAll('.vision-item-content > img.vision-item-image')).toHaveLength(1);
  expect(dispatches).toBe(1);
  dom.window.close();
});

test('old img alt values do not confirm a new upload of the same files', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  const { c } = setup({ initialImages: names.map(name => image(name)) });
  const pending = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await pending).success).toBe(false);
});

test('one accepted image plus duplicate wrapper matches fails closed without resending the batch', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    images.push(image(names[0], 9));
  } });
  const pending = c.AttachmentHandler.attach('Le Chat', names.map(png), {
    ...config,
    strategies: ['drop', 'paste', 'input']
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect((await pending).success).toBe(false);
  expect(dispatches).toBe(1);
});

test('a delayed second img alt arriving after the first timeout is observed before a fallback dispatch', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    if (dispatches === 1) {
      images.push(image(names[0]));
      setTimeout(() => images.push(image(names[1])), 750);
    }
  } });
  const pending = c.AttachmentHandler.attach('DeepSeek', names.map(png), {
    ...config,
    strategies: ['drop', 'input']
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect(await pending).toEqual(expect.objectContaining({ success: true, uploadedCount: 2 }));
  expect(dispatches).toBe(1);
});

test('a repair attach with the same files and run only observes the partial upload', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    if (dispatches === 1) images.push(image(names[0], 9));
  } });

  const first = c.AttachmentHandler.attach('Gemini', names.map(png), {
    ...config,
    strategies: ['drop', 'input']
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect((await first).success).toBe(false);
  const firstDispatchCount = dispatches;

  const repair = c.AttachmentHandler.attach('Gemini', names.map(png), {
    ...config,
    strategies: ['drop', 'input']
  });
  await jest.advanceTimersByTimeAsync(10000);
  expect((await repair).success).toBe(false);
  expect(dispatches).toBe(firstDispatchCount);
});

test('a new run can dispatch the same package while old previews remain baseline evidence', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  let runSessionId = 'run-1';
  const { c } = setup({ runSessionId, initialImages: names.map(name => image(name)), onDispatch() {
    dispatches += 1;
  } });
  c.ContentUtils.ensureDispatchMeta = () => ({ runSessionId });

  const first = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await first).success).toBe(false);
  const afterFirstRun = dispatches;

  runSessionId = 'run-2';
  const second = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await second).success).toBe(false);
  expect(dispatches).toBeGreaterThan(afterFirstRun);
});

test('without run identity a prior partial batch is not reused on a later attach call', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  const { c } = setup({ runSessionId: '', onDispatch(images) {
    dispatches += 1;
    if (dispatches === 1) images.push(image(names[0]));
  } });
  c.ContentUtils.ensureDispatchMeta = () => ({});

  const first = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await first).success).toBe(false);
  const afterFirst = dispatches;

  const second = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await second).success).toBe(false);
  expect(dispatches).toBeGreaterThan(afterFirst);
});

test('a different payload in the same run is not suppressed by the previous pending batch', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    if (dispatches === 1) images.push(image(names[0]));
  } });
  const first = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await first).success).toBe(false);
  const afterFirst = dispatches;

  const changedPayload = names.map((name, index) => ({
    ...png(name),
    base64: index === 0 ? 'data:image/png;base64,eQ==' : 'data:image/png;base64,eA=='
  }));
  const second = c.AttachmentHandler.attach('Qwen', changedPayload, config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await second).success).toBe(false);
  expect(dispatches).toBeGreaterThan(afterFirst);
});

test('a successfully confirmed batch is not cached for a later attachment request', async () => {
  const names = ['Снимок экрана 2026-10-18 в 06.06.22.png', 'Снимок экрана 2026-10-18 в 06.06.05.png'];
  let dispatches = 0;
  const { c } = setup({ onDispatch(images) {
    dispatches += 1;
    images.push(image(names[0]), image(names[1]));
  } });

  const first = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await first).success).toBe(true);
  const afterFirst = dispatches;

  const second = c.AttachmentHandler.attach('Qwen', names.map(png), config);
  await jest.advanceTimersByTimeAsync(10000);
  expect((await second).success).toBe(true);
  expect(dispatches).toBeGreaterThan(afterFirst);
});
