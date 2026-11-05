/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');

const builderSource = fs.readFileSync(path.join(__dirname, '..', 'content-scripts/answer-html-builder.js'), 'utf8');
const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

const responseFor = (bytes, contentType = 'image/png') => {
  let read = false;
  return {
    ok: true,
    status: 200,
    headers: { get: () => String(bytes.length) },
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true };
          read = true;
          return { done: false, value: bytes };
        },
        cancel: jest.fn()
      })
    },
    type: contentType
  };
};

describe('AnswerHtmlBuilder.materializeImages', () => {
  beforeEach(() => {
    delete window.AnswerHtmlBuilder;
    window.eval(builderSource);
  });

  test('embeds an allowed fetched raster image and preserves its alt and dimensions', async () => {
    window.fetch = jest.fn(async () => responseFor(pngBytes));
    const result = await window.AnswerHtmlBuilder.materializeImages(
      '<img data-ao-content-image="1" src="https://cdn.example/image.png" alt="Generated image" width="640" height="480">',
      document
    );
    const host = document.createElement('div');
    host.innerHTML = result.html;
    const image = host.querySelector('img');
    expect(image.getAttribute('src')).toBe(`data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`);
    expect(image.getAttribute('alt')).toBe('Generated image');
    expect(image.getAttribute('width')).toBe('640');
    expect(image.getAttribute('height')).toBe('480');
    expect(image.hasAttribute('data-ao-content-image')).toBe(false);
    expect(result.notes).toEqual([]);
  });

  test('recognizes older authority snapshots without the builder marker', async () => {
    window.fetch = jest.fn(async () => responseFor(pngBytes));
    const result = await window.AnswerHtmlBuilder.materializeImages(
      '<img src="https://cdn.example/image.png" alt="Generated image" width="640" height="480">',
      document
    );
    expect(result.html).toContain('data:image/png;base64,');
    expect(window.fetch).toHaveBeenCalledTimes(1);
  });

  test('replaces CORS and unsupported-image failures with visible text', async () => {
    window.fetch = jest.fn(async () => { throw new Error('CORS'); });
    const result = await window.AnswerHtmlBuilder.materializeImages(
      '<img data-ao-content-image="1" src="https://cdn.example/image.png" alt="Generated image" width="640" height="480">',
      document
    );
    expect(result.html).toContain('[Изображение не скопировано: источник недоступен (CORS, авторизация или таймаут)]');
    expect(result.html).not.toContain('<img');
    expect(result.notes).toContainEqual(expect.objectContaining({ type: 'image' }));

    window.fetch = jest.fn(async () => responseFor(new TextEncoder().encode('<svg/>'), 'image/svg+xml'));
    const unsafe = await window.AnswerHtmlBuilder.materializeImages(
      '<img data-ao-content-image="1" src="https://cdn.example/image.svg" alt="Generated image" width="640" height="480">',
      document
    );
    expect(unsafe.html).toContain('[Изображение не скопировано: небезопасный или нераспознанный тип]');
  });

  test('does not treat small UI images as answer content', async () => {
    window.fetch = jest.fn();
    const result = await window.AnswerHtmlBuilder.materializeImages(
      '<img src="https://cdn.example/avatar.png" alt="avatar" width="24" height="24">',
      document
    );
    expect(result.html).toContain('<img');
    expect(window.fetch).not.toHaveBeenCalled();
    expect(result.notes).toEqual([]);
  });
});
