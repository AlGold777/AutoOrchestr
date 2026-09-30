/** @jest-environment node */
const Delivery = require('../shared/message-delivery.js');

describe('message delivery', () => {
  beforeEach(() => Delivery.reset());

  test('each model gets its own token appended to its prompt', () => {
    const prompts = Delivery.prepare({ prompt: 'Обсудим идею', models: ['GPT', 'Claude'] });
    const tokens = Object.values(prompts).map((p) => /\[\[(AO-[a-z0-9]{6})\]\]$/.exec(p)[1]);
    expect(prompts.GPT.startsWith('Обсудим идею')).toBe(true);
    expect(new Set(tokens).size).toBe(2);
  });

  test('verified, missing and foreign answers', () => {
    const prompts = Delivery.prepare({ prompt: 'Q', models: ['GPT'] });
    const token = /\[\[AO-[a-z0-9]{6}\]\]/.exec(prompts.GPT)[0];
    expect(Delivery.receive({ llmName: 'GPT', answer: 'Старый ответ [[AO-zzzzzz]]' }, { final: true })).toBeNull();
    const ok = Delivery.receive({ llmName: 'GPT', answer: `Ответ\n\n${token}`, answerHtml: `<p>Ответ</p><p>${token}</p>` }, { final: true });
    expect(ok.answer).toBe('Ответ');
    expect(ok.answerHtml).toBe('<p>Ответ</p>');
    expect(ok.metadata.attributionState).toBeUndefined();
    Delivery.prepare({ prompt: 'Q2', models: ['GPT'] });
    const missing = Delivery.receive({ llmName: 'GPT', answer: 'Без метки' }, { final: true });
    expect(missing.metadata.attributionState).toBe('unproven');
    const kinds = Delivery.journal().map((e) => e.kind);
    expect(kinds).toEqual(['sent', 'stale_dropped', 'verified', 'sent', 'missing_token']);
  });

  test('partial answers are cleaned but never marked', () => {
    Delivery.prepare({ prompt: 'Q', models: ['GPT'] });
    const partial = Delivery.receive({ llmName: 'GPT', answer: 'Печатает…' }, { final: false });
    expect(partial.metadata.attributionState).toBeUndefined();
  });

  test('untracked models pass through untouched', () => {
    const message = { llmName: 'Grok', answer: 'x' };
    expect(Delivery.receive(message, { final: true })).toBe(message);
  });

  test('clean removes tokens, echoed instructions and <<< >>> markers', () => {
    const text = '<<<RESPONSE ab12 GPT START>>>\nТекст\nПоследней строкой ответа напиши только метку [[AO-abcdef]]\n<<<RESPONSE ab12 GPT END>>>\n[[AO-abcdef]]';
    expect(Delivery.clean(text)).toBe('Текст');
    expect(Delivery.cleanHtml('<p>&lt;&lt;&lt;RESPONSE x END&gt;&gt;&gt;</p><p>A</p>')).toBe('<p>A</p>');
  });
});
