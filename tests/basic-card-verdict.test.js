const fs = require('fs');
const path = require('path');

require('../results/basic-card-verdict.js');

const Verdict = window.BasicCardVerdict;
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function makeCard({ model = 'GPT', participant = 'gpt-author', round = 's1', visit = '', kind = 'answer', text = '' } = {}) {
  const card = document.createElement('article');
  card.className = 'debate-model-card';
  card.dataset.llmName = model;
  if (participant) card.dataset.participantId = participant;
  if (round) card.dataset.pipelineRoundId = round;
  if (visit) card.dataset.visit = visit;
  card.dataset.kind = kind;
  const header = document.createElement('div');
  header.className = 'debate-model-card-header';
  const output = document.createElement('div');
  output.className = 'debate-model-card-output';
  output.textContent = text;
  card.append(header, output);
  return card;
}

function setup(...cards) {
  const container = document.createElement('div');
  container.id = 'debate-model-cards';
  container.append(...cards);
  document.body.replaceChildren(container);
  return container;
}

const attempt = (over = {}) => ({
  model: 'GPT', participant: 'gpt-author', step: 0, visit: 1, label: 'Черновик', ref: 'r1',
  answer: 'Итоговый текст', accepted: true, reason: '', ...over
});

describe('L-20: карточка участника Basic показывает вердикт движка', () => {
  test('принятая попытка: карточка помечена accepted и пометка о непринятии снята', () => {
    const card = makeCard({ text: 'Итоговый текст' });
    card.insertBefore(Object.assign(document.createElement('div'), { className: 'basic-card-verdict', textContent: 'Не принято: старое' }), card.lastChild);
    const container = setup(card);
    const marked = Verdict.mark(container, attempt({ accepted: true }), '');
    expect(marked).toBe(card);
    expect(card.dataset.accepted).toBe('true');
    expect(card.querySelector('.basic-card-verdict')).toBeNull();
    expect(card.querySelector('.debate-model-card-output').textContent).toBe('Итоговый текст');
  });

  test('отклонённая попытка: последний ответ остаётся, но с пометкой причины, не как принятый', () => {
    const card = makeCard({ text: 'Проверил и уточнил технические риски. Ответ будет ниже.' });
    const container = setup(card);
    Verdict.mark(container, attempt({ accepted: false, reason: 'too_short' }), 'ответ короче минимума');
    expect(card.dataset.accepted).toBe('false');
    const notice = card.querySelector('.basic-card-verdict');
    expect(notice).not.toBeNull();
    expect(notice.textContent).toContain('Не принято: ответ короче минимума');
    expect(notice.textContent).toContain('не принят');
    expect(card.querySelector('.debate-model-card-output').textContent).toBe('Проверил и уточнил технические риски. Ответ будет ниже.');
    expect(notice.previousElementSibling).toBe(card.querySelector('.debate-model-card-output'));
  });

  test('повторная отклонённая попытка не дублирует пометку', () => {
    const card = makeCard({ text: 'Текст' });
    const container = setup(card);
    Verdict.mark(container, attempt({ accepted: false }), 'первая');
    Verdict.mark(container, attempt({ accepted: false }), 'вторая');
    expect(card.querySelectorAll('.basic-card-verdict')).toHaveLength(1);
    expect(card.querySelector('.basic-card-verdict').textContent).toContain('вторая');
  });

  test('пустой id участника или модели не сопоставляется ни с одной карточкой', () => {
    const card = makeCard({ participant: '' , text: 'Текст' });
    const container = setup(card);
    expect(Verdict.find(container, attempt({ participant: '' }))).toBeNull();
    expect(Verdict.find(container, attempt({ model: '' }))).toBeNull();
    expect(Verdict.mark(container, attempt({ participant: '', accepted: false }), 'x')).toBeNull();
    expect(card.querySelector('.basic-card-verdict')).toBeNull();
    expect(card.dataset.accepted).toBeUndefined();
  });

  test('чужой участник той же модели не получает вердикт', () => {
    const other = makeCard({ participant: 'gpt-reviewer', text: 'Чужой' });
    const container = setup(other);
    expect(Verdict.mark(container, attempt({ participant: 'gpt-author', accepted: true }), '')).toBeNull();
    expect(other.dataset.accepted).toBeUndefined();
  });

  test('карточка другого раунда не получает вердикт', () => {
    const card = makeCard({ round: 's2', text: 'Раунд 2' });
    const container = setup(card);
    expect(Verdict.mark(container, attempt({ step: 0, accepted: true }), '')).toBeNull();
    expect(card.dataset.accepted).toBeUndefined();
  });

  test('повтор визита сопоставляется с карточкой своего визита (s1v2)', () => {
    const first = makeCard({ round: 's1', text: 'Визит 1' });
    const second = makeCard({ round: 's1v2', text: 'Визит 2' });
    const container = setup(first, second);
    expect(Verdict.find(container, attempt({ visit: 2 }))).toBe(second);
    expect(Verdict.find(container, attempt({ visit: 1 }))).toBe(first);
  });

  test('попытка без вердикта (не отправлена, unknown) карточку не меняет', () => {
    const card = makeCard({ text: 'Текст' });
    const container = setup(card);
    expect(Verdict.mark(container, { model: 'GPT', participant: 'gpt-author', step: 0, visit: 1, state: 'not_sent' }, '')).toBeNull();
    expect(card.dataset.accepted).toBeUndefined();
    expect(card.querySelector('.basic-card-verdict')).toBeNull();
  });

  test('карточка модуля не берёт служебные карточки (moderator/fragment)', () => {
    const moderator = makeCard({ kind: 'moderator', text: 'Модератор' });
    const container = setup(moderator);
    expect(Verdict.find(container, attempt())).toBeNull();
  });
});

describe('L-20: связь в results.js', () => {
  const results = read('results.js');

  test('хук вердикта вызывается из recordAttempt до проверки записи', () => {
    const hook = results.indexOf('const showBasicCardVerdict = (entry) => {');
    const recordAttempt = results.indexOf('const recordAttempt = (entry) => {');
    expect(hook).toBeGreaterThan(0);
    expect(recordAttempt).toBeGreaterThan(hook);
    expect(results.slice(recordAttempt, recordAttempt + 120)).toContain('showBasicCardVerdict(entry);');
  });

  test('принятый текст пишется в карточку через updateDebateModelCardOutput с answerRevision и не создаёт карточку', () => {
    const hook = results.slice(results.indexOf('const showBasicCardVerdict = (entry) => {'), results.indexOf('const recordAttempt = (entry) => {'));
    expect(hook).toContain('if (!card) return;');
    expect(hook).toContain('entry.accepted === true && answer && body');
    expect(hook).toContain('answerRevision: true');
    expect(hook).toContain('window.BasicCardVerdict.mark(debateModelCards, entry, reasonText);');
  });

  test('wrong_card срабатывает только при двух разных непустых id или при отсутствующей панели', () => {
    expect(read('results.js')).toContain('const outcome = !panel || (expectedCardId && observedCardId && expectedCardId !== observedCardId)');
  });

  test('модуль подключён на странице панели Basic', () => {
    expect(read('pipeline_panel.html')).toContain('<script src="results/basic-card-verdict.js"></script>');
  });
});
