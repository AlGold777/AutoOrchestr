/** @jest-environment jsdom */
const { TextEncoder, TextDecoder } = require('util');
const fs = require('fs');
const path = require('path');

global.TextDecoder = TextDecoder;
const QwenCompare = require('../results/qwen-compare');

const page = fs.readFileSync(path.join(__dirname, '..', 'qwen-compare.html'), 'utf8');
const flush = () => new Promise((resolve) => setTimeout(resolve));
const stream = (lines) => {
  const chunks = [new TextEncoder().encode(lines.map((line) => JSON.stringify(line)).join('\n'))];
  return { ok: true, body: { getReader: () => ({ read: async () => (chunks.length ? { value: chunks.shift(), done: false } : { done: true }) }) } };
};
const reply = (text) => stream([{ message: { content: text } }, { done: true, eval_count: 10, eval_duration: 1e9 }]);
const logs = () => [...document.querySelectorAll('.log')].map((node) => node.textContent);

function open(fetchImpl) {
  document.body.innerHTML = page.replace(/[\s\S]*<body[^>]*>/, '').replace(/<\/body>[\s\S]*/, '').replace(/<script[^>]*><\/script>/g, '');
  QwenCompare.start(document, { endpoint: 'http://local', prepare: async () => {}, fetchImpl });
  return document.getElementById('prompt');
}
const submit = async (field, text) => {
  field.value = text;
  document.getElementById('composer').dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  await flush();
};

describe('qwen-compare page', () => {
  test('one question goes to both models and each answer stays in its window', async () => {
    const fetchImpl = jest.fn(async (url, init) => reply(JSON.parse(init.body).model.includes('4b') ? 'ответ четыре' : 'ответ девять'));
    const field = open(fetchImpl);
    await submit(field, 'вопрос');
    expect(fetchImpl.mock.calls.map(([, init]) => JSON.parse(init.body).model)).toEqual(['qwen3.5:4b-mlx', 'qwen3.5:9b-mlx']);
    expect(logs()[0]).toContain('ответ четыре');
    expect(logs()[1]).toContain('ответ девять');
    expect(field.value).toBe('');
  });

  test('the second question carries the conversation of its own model', async () => {
    const bodies = [];
    const field = open(async (url, init) => { bodies.push(JSON.parse(init.body)); return reply(`ответ ${bodies.length}`); });
    await submit(field, 'первый');
    await submit(field, 'второй');
    const fourth = bodies.filter((body) => body.model.includes('4b'))[1];
    expect(fourth.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
    expect(fourth.messages[0].content).toBe('первый');
  });

  test('Очистить empties the question field, both windows and the conversations', async () => {
    const bodies = [];
    const field = open(async (url, init) => { bodies.push(JSON.parse(init.body)); return reply('ответ'); });
    await submit(field, 'первый');
    field.value = 'недописанный вопрос';
    document.getElementById('clear').click();
    expect(field.value).toBe('');
    expect(logs()).toEqual(['', '']);
    await submit(field, 'новый');
    expect(bodies[bodies.length - 1].messages).toHaveLength(1);
  });

  test('without the service each window says so', async () => {
    const field = open(async () => { throw new TypeError('Failed to fetch'); });
    await submit(field, 'вопрос');
    expect(logs().every((text) => text.includes('Ollama не отвечает'))).toBe(true);
    expect(document.getElementById('send').textContent).toBe('Отправить');
  });
});
