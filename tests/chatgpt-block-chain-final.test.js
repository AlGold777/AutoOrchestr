/** @jest-environment node */
// L-3: ChatGPT draws a turn as a chain of blocks (progress lines, a draft, the final answer).
// While Stop is visible, the final block with the delivery token is awaited, never a preamble.
// Fixtures follow run 948 (GPT r1 attempt 1: a 289-char preamble; GPT r3: a 36-char progress line).
globalThis.AnswerContentClassifier = require('../shared/answer-content-classifier.js');
const TurnResolver = require('../content-scripts/turn-resolver.js');

const TOKEN = '[[AO-k3m9q2]]';
const node = (id) => ({ id, closest: () => null });
const entry = (id, text) => ({ node: node(id), text });

// Run 948 r1: the progress verb opens the preamble and it runs past 200 characters.
const PREAMBLE_289 = 'Проверю платформенные ограничения iOS/Android и практические варианты записи с восстановлением после сбоя. '
  + 'Затем сведу решения в единую архитектуру с альтернативами, протоколом сопряжения и критериями отказов. '
  + 'Проработал архитектуру безопасности и проверил сетевые сценарии';
const PROGRESS_LINE = 'Уточнил план ответа';
const PROGRESS_36 = 'Проверил и уточнил технические риски';
const FINAL = `Итог: архитектура с двумя каналами, протоколом сопряжения и отдельным сценарием восстановления.\n${TOKEN}`;

describe('ChatGPT block chain: the final block is the answer while Stop is visible', () => {
  test('preamble first, final with the token last: the token block is chosen', () => {
    const entries = [entry('progress', PROGRESS_LINE), entry('draft', PREAMBLE_289), entry('final', FINAL)];
    expect(TurnResolver.pickChatGptAnswerNode(entries, { stopVisible: true }).id).toBe('final');
    expect(TurnResolver.pickChatGptAnswerNode(entries, { stopVisible: false }).id).toBe('final');
  });

  test('Stop visible and the final block not rendered yet: wait (null), not the 289-char preamble', () => {
    const entries = [entry('progress', PROGRESS_LINE), entry('draft', PREAMBLE_289)];
    expect(TurnResolver.pickChatGptAnswerNode(entries, { stopVisible: true })).toBeNull();
  });

  test('Stop not visible without any token: the legacy fallback still returns the last non-progress block', () => {
    const entries = [entry('progress', PROGRESS_LINE), entry('draft', PREAMBLE_289)];
    expect(TurnResolver.pickChatGptAnswerNode(entries, { stopVisible: false }).id).toBe('draft');
  });

  test('a lone 36-char progress line while Stop is visible is not an answer (run 948 r3)', () => {
    const entries = [entry('progress', PROGRESS_36)];
    expect(TurnResolver.pickChatGptAnswerNode(entries, { stopVisible: true })).toBeNull();
  });

  test('a progress verb without a verdict is a progress line; with a verdict it is not', () => {
    expect(TurnResolver.isChatGptProgressLine(node('p'), PROGRESS_36, [])).toBe(true);
    expect(TurnResolver.isChatGptProgressLine(node('v'), 'Проверил, замечаний нет.', [])).toBe(false);
  });

  test('the last block with the token wins over an earlier token block', () => {
    const earlier = `Черновик\n[[AO-aaaaaa]]`;
    const entries = [entry('old', earlier), entry('progress', PROGRESS_LINE), entry('final', FINAL)];
    expect(TurnResolver.pickChatGptAnswerNode(entries, { stopVisible: true }).id).toBe('final');
  });

  test('a span > span progress block is still a progress line regardless of the Stop state', () => {
    const spanNode = { id: 'nested', closest: () => ({ parentElement: { closest: () => ({}) } }) };
    expect(TurnResolver.isChatGptProgressLine(spanNode, PREAMBLE_289, [])).toBe(true);
  });
});
