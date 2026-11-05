/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const builderSource = read('content-scripts/answer-html-builder.js');
const routerSource = read('background/message-router.js');
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

describe('ChatGPT generated image transport fallback', () => {
  beforeEach(() => {
    delete window.AnswerHtmlBuilder;
    window.fetch = jest.fn(async () => { throw new TypeError('CORS'); });
    window.chrome = { runtime: { sendMessage: jest.fn() } };
    window.eval(builderSource);
  });

  test('uses the worker bridge only for images.openai.com static-rsc-4 images and embeds a signature-verified raster', async () => {
    window.chrome.runtime.sendMessage.mockResolvedValue({
      ok: true,
      mime: 'image/png',
      data: Buffer.from(pngBytes).toString('base64')
    });
    const url = 'https://images.openai.com/static-rsc-4/image-id?token=secret';
    const result = await window.AnswerHtmlBuilder.materializeImages(
      `<img data-ao-content-image="1" src="${url}" alt="Generated image" width="640" height="480">`, document
    );

    expect(window.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'MATERIALIZE_OPENAI_STATIC_IMAGE', url });
    expect(result.html).toContain(`src="data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}"`);
    expect(result.html).toContain('alt="Generated image"');
    expect(result.notes).toEqual([]);
  });

  test('does not bridge other hosts, other OpenAI paths, or bytes with a mismatched signature', async () => {
    const urls = [
      'https://cdn.openai.com/static-rsc-4/image-id',
      'https://images.openai.com/static-rsc-3/image-id'
    ];
    for (const url of urls) {
      await window.AnswerHtmlBuilder.materializeImages(`<img data-ao-content-image="1" src="${url}">`, document);
    }
    window.chrome.runtime.sendMessage.mockResolvedValue({
      ok: true,
      mime: 'image/png',
      data: Buffer.from('not an image').toString('base64')
    });
    await window.AnswerHtmlBuilder.materializeImages(
      '<img data-ao-content-image="1" src="https://images.openai.com/static-rsc-4/image-id">', document
    );

    expect(window.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  test('router source isolates the action from logging and validates sender, URL, redirect, size, timeout, and signature', () => {
    const actionIndex = routerSource.indexOf("message?.type === 'MATERIALIZE_OPENAI_STATIC_IMAGE'");
    const listenerIndex = routerSource.indexOf('chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {');
    const loggerIndex = routerSource.indexOf('globalThis.LLMLog?.debug?.("[BACKGROUND] Received message:", message);', listenerIndex);
    const actionBlock = routerSource.slice(actionIndex, loggerIndex);

    expect(actionIndex).toBeGreaterThan(listenerIndex);
    expect(loggerIndex).toBeGreaterThan(actionIndex);
    expect(actionBlock).toContain('handleOpenAiStaticImageRequest(message, sender)');
    expect(routerSource).toContain("['chatgpt.com', 'chat.openai.com'].includes(url.hostname)");
    expect(routerSource).toContain("url.hostname !== 'images.openai.com'");
    expect(routerSource).toContain("url.pathname.startsWith('/static-rsc-4/')");
    expect(routerSource).toContain("redirect: 'error'");
    expect(routerSource).toContain('OPENAI_STATIC_IMAGE_TIMEOUT_MS = 7000');
    expect(routerSource).toContain('OPENAI_STATIC_IMAGE_MAX_BYTES = 10 * 1024 * 1024');
    expect(routerSource).toContain('sniffOpenAiRasterMime(bytes)');
  });
});
