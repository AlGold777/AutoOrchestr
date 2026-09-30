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
    expect(kinds).toEqual(['sent', 'stale_dropped', 'first_text', 'verified', 'sent', 'first_text', 'missing_token']);
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

describe('delivery diagnosis', () => {
  const Diagnosis = require('../shared/message-delivery-diagnosis.js');
  const at = (n) => new Date(Date.UTC(2026, 8, 30, 10, 0, n)).toISOString();
  const sent = (model, token, n = 0) => ({ at: at(n), kind: 'sent', model, token, batchId: 'B1', chars: 100 });

  test('journal events are folded into per-message timelines', () => {
    Delivery.reset();
    Delivery.prepare({ prompt: 'Q', models: ['GPT'] });
    Delivery.observeRuntime({ type: 'GLOBAL_STATE_BROADCAST', state: { tabs: { map: { GPT: 41 } } } });
    Delivery.observeRuntime({ type: 'STATUS_UPDATE', llmName: 'GPT', status: 'generating' });
    Delivery.observeRuntime({ type: 'STATUS_UPDATE', llmName: 'GPT', status: 'generating' });
    const token = /\[\[AO-[a-z0-9]{6}\]\]/.exec(Delivery.wrap('x', Delivery.journal()[0].token))[0];
    Delivery.receive({ llmName: 'GPT', answer: 'Частичный' }, { final: false });
    Delivery.receive({ llmName: 'GPT', answer: `Готово ${token}`, status: 'SUCCESS' }, { final: true });
    const { sends, problems } = Diagnosis.diagnose(Delivery.journal());
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ model: 'GPT', tab: 41, statuses: ['GENERATING'], result: 'delivered' });
    expect(sends[0].firstTextMs).not.toBeNull();
    expect(problems).toEqual([]);
  });

  test('the real failure from the field report is explained', () => {
    const journal = [
      sent('DeepSeek', 'AO-a', 0), sent('Le Chat', 'AO-b', 0), sent('Perplexity', 'AO-c', 0),
      { at: at(1090), kind: 'missing_token', model: 'DeepSeek', token: 'AO-a', chars: 0, ms: 1090158 }
    ];
    const { sends, problems } = Diagnosis.diagnose(journal);
    expect(sends.map((s) => s.result)).toEqual(['no_tab', 'waiting', 'waiting']);
    expect(problems.find((p) => p.model === 'DeepSeek')).toMatchObject({ code: 'no_tab', severity: 'critical' });
  });

  test('no tab vs no answer vs empty vs no token vs stale', () => {
    const journal = [
      sent('A', 't1'), { at: at(9), kind: 'no_answer', model: 'A', token: 't1', ms: 9000, timedOut: true },
      sent('B', 't2'), { at: at(1), kind: 'tab', model: 'B', token: 't2', tabId: 7 }, { at: at(9), kind: 'no_answer', model: 'B', token: 't2', ms: 9000, timedOut: true },
      sent('C', 't3'), { at: at(1), kind: 'tab', model: 'C', token: 't3', tabId: 8 }, { at: at(2), kind: 'empty_answer', model: 'C', token: 't3', chars: 0, ms: 2000, status: 'ERROR', reason: 'empty_answer' },
      sent('D', 't4'), { at: at(1), kind: 'first_text', model: 'D', token: 't4', ms: 1000, chars: 5 }, { at: at(2), kind: 'missing_token', model: 'D', token: 't4', chars: 5, ms: 2000 },
      sent('E', 't5'), { at: at(1), kind: 'stale_dropped', model: 'E', token: 't5' }, { at: at(1), kind: 'tab', model: 'E', token: 't5', tabId: 9 }, { at: at(3), kind: 'verified', model: 'E', token: 't5', chars: 9, ms: 3000, status: 'SUCCESS' }
    ];
    const { sends, problems, matrix } = Diagnosis.diagnose(journal);
    expect(Object.fromEntries(sends.map((s) => [s.model, s.result]))).toEqual({ A: 'no_tab', B: 'no_answer', C: 'empty', D: 'no_token', E: 'delivered' });
    expect(problems.map((p) => `${p.model}:${p.code}`)).toEqual(expect.arrayContaining(['A:no_tab', 'B:no_answer', 'C:empty', 'D:no_token', 'E:stale']));
    expect(problems[0].severity).toBe('critical');
    expect(matrix.find((r) => r.model === 'E')).toMatchObject({ delivered: 1, stale: 1, medianMs: 3000 });
  });

  test('a failed terminal status is an error even with a token', () => {
    const journal = [sent('A', 't1'), { at: at(2), kind: 'verified', model: 'A', token: 't1', chars: 4, ms: 2000, status: 'TIMEOUT', reason: 'x' }];
    expect(Diagnosis.diagnose(journal).sends[0].result).toBe('error');
  });

  test('closeBatch records models that never answered, once', () => {
    Delivery.reset();
    Delivery.prepare({ prompt: 'Q', models: ['GPT', 'Claude'] });
    Delivery.closeBatch({ models: ['GPT', 'Claude'], timedOut: true });
    Delivery.closeBatch({ models: ['GPT'], timedOut: true });
    expect(Delivery.journal().filter((e) => e.kind === 'no_answer')).toHaveLength(2);
  });
});
