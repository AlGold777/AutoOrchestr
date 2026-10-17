/** @jest-environment jsdom */
const fs = require('fs');
const path = require('path');
const StageCard = require('../results/stage-card');
const BasicOutput = require('../disput/basic-output');

const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const results = read('results.js');
const { feed } = StageCard;

describe('Basic run feed: answer card label (1)', () => {
  test('step, participant and visit: the visit is named from the second one', () => {
    expect(feed.role({ label: 'Раунд 2', modelName: 'Claude', participantId: 'B', visit: 2 })).toBe('Basic · Раунд 2 · участник B · заход 2');
    expect(feed.role({ label: 'Раунд 2', modelName: 'Claude', participantId: 'B', visit: 1 })).toBe('Basic · Раунд 2 · участник B');
  });

  test('a participant id equal to the model name is not repeated; old events without the fields keep the label', () => {
    expect(feed.role({ label: 'Раунд 1', modelName: 'GPT', participantId: 'GPT', visit: 1 })).toBe('Basic · Раунд 1');
    expect(feed.role({ label: 'Синтез после раунда 1' })).toBe('Basic · Синтез после раунда 1');
  });
});

describe('Basic run feed: control events are short lines (2)', () => {
  test('a gate says whether it passed, and the unmet criteria only when it did not', () => {
    expect(feed.gate({ ref: 'g1', pass: true, unmet: [] })).toBe('Проверка g1: пройдена');
    expect(feed.gate({ ref: 'g1', pass: false, unmet: ['ошибок нет', 'есть ссылки'] })).toBe('Проверка g1: не пройдена. Не выполнено: ошибок нет; есть ссылки');
    expect(feed.gate({ ref: 'g1', pass: false, unmet: [] })).toBe('Проверка g1: не пройдена');
  });

  test('a route names the chosen case and the reason of the choice', () => {
    expect(feed.route({ ref: 'r3', caseLabel: 'Доработать', reason: 'rule' })).toBe('Маршрут r3: вариант «Доработать», по правилу');
    expect(feed.route({ ref: 'r3', caseLabel: 'Принять', reason: 'owner' })).toBe('Маршрут r3: вариант «Принять», выбрал владелец');
    expect(feed.route({ ref: 'r3', caseLabel: 'x', reason: 'unknown_reason' })).toBe('Маршрут r3: вариант «x», unknown_reason');
  });

  test('a transition names the target and the count of a limited one', () => {
    expect(feed.transition({ from: 'r4', to: 'r2', action: 'return' })).toBe('Возврат r4 → r2');
    expect(feed.transition({ from: 'g1', to: 'r2', action: 'goto', count: 2, maxLoops: 3 })).toBe('Переход g1 → r2, переход 2 из 3');
    expect(feed.transition({ from: 'g1', to: 'final', action: 'goto', count: null, maxLoops: null })).toBe('Переход g1 → final');
  });

  test('a stop by a transition names the reason; a limit that is used up names its count', () => {
    const stopText = (reason) => ({ stopped: 'остановлено владельцем' })[reason] || reason;
    expect(feed.transition({ from: 'g1', action: 'stop', reason: 'stopped' }, stopText)).toBe('Прогон остановлен после g1: остановлено владельцем');
    expect(feed.transition({ from: 'g1', to: 'r2', action: 'stop', reason: 'loop_limit', maxLoops: 2 }, stopText)).toBe('Переход g1 → r2 не выполнен: лимит 2 исчерпан');
  });
});

describe('Basic run feed: stale versions and artifacts (3, 4)', () => {
  test('an artifact is titled by name, author and visit; a stale one says so', () => {
    const source = { step: 'r1', participant: 'B', visit: 2 };
    expect(feed.artifactTitle({ name: 'Черновик', source, valid: true })).toBe('Черновик · участник B · заход 2');
    expect(feed.artifactTitle({ name: 'Черновик', source, valid: false })).toBe('Черновик · участник B · заход 2 · устарело');
    expect(feed.artifactTitle({ name: 'Итог', source: { step: 'final', participant: 'owner', visit: 1 } })).toBe('Итог · владелец · заход 1');
  });

  test('the text of an artifact is the whole answer, or the value at its pointer (a text as it is, a list as JSON)', () => {
    const answer = JSON.stringify({ map: 'карта', list: [1, 2] });
    expect(feed.artifactText('целый ответ', '', BasicOutput.readPointer)).toBe('целый ответ');
    expect(feed.artifactText(answer, '/map', BasicOutput.readPointer)).toBe('карта');
    expect(feed.artifactText(answer, '/list', BasicOutput.readPointer)).toBe('[\n  1,\n  2\n]');
    expect(feed.artifactText(answer, '/missing', BasicOutput.readPointer)).toBe('Указатель /missing не найден в ответе.');
    expect(feed.artifactText('не json', '/map', BasicOutput.readPointer)).toBe('Указатель /map: ответ не является JSON.');
  });
});

describe('Basic run feed: wiring in the page (results.js)', () => {
  test('the answer card takes its label from the feed and its round per visit', () => {
    expect(results).toContain('role: window.StageCard?.feed?.role({ label, modelName: model, participantId: request?.participantId, visit: request?.visit })');
    expect(results).toContain("pipelineRoundId: `s${step + 1}${request?.visit > 1 ? `v${request.visit}` : ''}`,");
  });

  test('the gate, route and transition events go to the feed as lines; the other events do not', () => {
    expect(results).toContain("if (kind === 'custom_gate') appendBasicRunLine(window.StageCard?.feed?.gate(fields));");
    expect(results).toContain("if (kind === 'custom_route') {");
    expect(results).toContain("if (kind === 'custom_transition') appendBasicRunLine(window.StageCard?.feed?.transition(fields, (reason) => engine.STOP_TEXT[reason] || reason));");
    expect(results).toContain("window.MessageDelivery?.batchEvent?.(kind, { pipelineRunId: runContext.pipelineRunId, ...fields });");
  });

  test('at the end the stale versions are marked and the registry is one line with an opener', () => {
    expect(results).toContain('markStaleBasicCards(result.steps);');
    expect(results).toContain("if (artifacts.length) {");
    expect(results).toContain("appendBasicRunLine(`Артефакты прогона: ${artifacts.length}`, { buttonLabel: 'Открыть', onButton: () => openBasicArtifacts(artifacts, textOf) });");
    expect(results).toContain("const textOf = (ref) => (record ? window.CustomRunRecord.textOf(record, ref) : String(result.texts?.[ref] ?? ''));");
  });

  test('the registry opens its content with the choice dialog, not with new markup', () => {
    const block = results.slice(results.indexOf('const openBasicArtifacts = async'), results.indexOf('const runCustomFromPage = async'));
    expect(block).toContain('await askChoiceDialog({');
    expect(block).toContain('window.StageCard.feed.artifactText(textOf(item.content.answerRef), item.content.pointer, window.BasicOutput.readPointer)');
    expect(block).not.toMatch(/createElement\(['"]dialog/);
  });

  test('the stale mark and the run line have their styles', () => {
    const css = read('styles/modals-responsive.css');
    expect(css).toContain('.basic-run-line {');
    expect(css).toContain('.basic-run-stale {');
  });
});
