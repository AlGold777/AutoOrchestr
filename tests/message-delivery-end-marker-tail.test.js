/** @jest-environment node */
// L-28: endMarkerSeen uses the shared hasDeliveryTokenTail predicate. Behaviour is unchanged:
// the token must be the last line (at most 40 characters after it) and the answer must have content.
const Delivery = require('../shared/message-delivery.js');

const tokenFor = (prompts, model) => /\[\[AO-[a-z0-9]{6}\]\]/.exec(prompts[model])[0];

describe('endMarkerSeen follows the delivery token tail predicate', () => {
  beforeEach(() => Delivery.reset());

  test('token at the end of the answer marks the end', () => {
    const prompts = Delivery.prepare({ prompt: 'Q1', models: ['GPT'] });
    const msg = Delivery.receive({ llmName: 'GPT', answer: `Готово.\n${tokenFor(prompts, 'GPT')}` }, { final: true });
    expect(msg.metadata.answerEndMarkerSeen).toBe(true);
  });

  test('provider chrome of up to 40 characters after the token still marks the end', () => {
    const prompts = Delivery.prepare({ prompt: 'Q2', models: ['GPT'] });
    const msg = Delivery.receive({ llmName: 'GPT', answer: `Готово.\n${tokenFor(prompts, 'GPT')} 10:42 PM` }, { final: true });
    expect(msg.metadata.answerEndMarkerSeen).toBe(true);
  });

  test('token followed by more than 40 characters does not mark the end', () => {
    const prompts = Delivery.prepare({ prompt: 'Q3', models: ['GPT'] });
    const tail = 'x'.repeat(60);
    const msg = Delivery.receive({ llmName: 'GPT', answer: `Готово.\n${tokenFor(prompts, 'GPT')} ${tail}` }, { final: true });
    expect(msg.metadata.answerEndMarkerSeen).toBe(false);
  });

  test('a progress line with the marker does not mark the end (L-2 behaviour kept)', () => {
    const prompts = Delivery.prepare({ prompt: 'Q4', models: ['GPT'] });
    const msg = Delivery.receive({ llmName: 'GPT', answer: `Проверю план и риски.\n${tokenFor(prompts, 'GPT')}` }, { final: false });
    expect(msg.metadata.answerEndMarkerSeen).toBe(false);
  });
});
