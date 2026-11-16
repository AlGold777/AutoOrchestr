// Собирает схемы Basic из запросов папки ../prompts и проверяет их валидатором Basic.
// Запуск из корня проекта: node docs/Researcher/basic/build-schemas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const promptsDir = path.join(here, '..', 'prompts');
const outDir = path.join(here, 'schemas');
const require = createRequire(import.meta.url);
const BasicSchema = require(path.join(here, '..', '..', '..', 'disput', 'basic-schema.js'));

// --- Запросы: блок ```text под заголовком «## <код> · <роль>» ---
const prompts = {};
const titles = {};
for (const file of fs.readdirSync(promptsDir).filter((name) => /^\d.*\.md$/.test(name))) {
  const text = fs.readFileSync(path.join(promptsDir, file), 'utf8');
  const re = /^## ([A-Za-z0-9-]+) · (.+)$[\s\S]*?```text\n([\s\S]*?)\n```/gm;
  for (let match; (match = re.exec(text));) {
    if (prompts[match[1]]) throw new Error(`Код запроса повторяется: ${match[1]}`);
    prompts[match[1]] = match[3].trim();
    titles[match[1]] = match[2].trim();
  }
}
const readme = fs.readFileSync(path.join(promptsDir, 'README.md'), 'utf8');
const COMMON = /## 2\. Общие правила[\s\S]*?```text\n([\s\S]*?)\n```/.exec(readme)[1].trim();

const used = new Set();
const P = (code) => {
  if (!prompts[code]) throw new Error(`Нет запроса ${code}`);
  used.add(code);
  return prompts[code];
};

// --- Конструкторы ---
const PACKAGE_LIMIT = 12000; // знаков: предел пакета цикла (текст задачи)
const CHARS_PER_WORD = 7;
const REQUEST_BUDGET = 52000;

const art = (step, participant, id) => ({ artifact: { step, participant, id }, version: 'latest', required: true });
const doc = (id, name) => ({ document: 'read', artifacts: [{ id, name, pointer: '' }] });
// Участник: модель, ID, код запроса, предел слов, прочее.
const who = (name, id, code, maxWords, extra = {}) => ({ name, id, label: `${titles[code]} · ${name}`, code, maxWords, ...extra });
// Участник, который не получает текст задачи: только вход и задание.
const blind = (name, id, code, maxWords) => ({ name, id, label: `${titles[code]} · ${name}`, request: `${P(code)}\n\nВходные данные:\n{вход}`, maxWords });
// Раунд: общий запрос участников становится заданием шага.
const round = (title, models, extra = {}) => {
  const codes = [...new Set(models.map((model) => model.code).filter(Boolean))];
  if (codes.length > 1) throw new Error(`В раунде «${title}» разные запросы: ${codes.join(', ')}`);
  const clean = models.map(({ code, ...model }) => model);
  return { kind: 'round', title, ...(codes.length ? { task: P(codes[0]) } : {}), models: clean, ...extra };
};
const owner = (id, code, extra = {}) => ({ ref: `owner:${id}`, kind: 'owner', models: [], task: P(code), ...extra });

function schema(description, steps, taskLimit = PACKAGE_LIMIT) {
  let n = 0;
  const numbered = steps.map((step) => (step.kind === 'round' ? { ref: `r${++n}`, ...step } : step));
  return {
    doc: {
      schemaVersion: 2,
      origin: 'user',
      description,
      run: { policy: 'auto', maxWords: 1000 },
      defaults: { discipline: { limit: 'Объём ответа — не больше {слов} слов.', content: COMMON } },
      steps: numbered,
    },
    taskLimit,
  };
}

// --- Составы ---
const ALL = [['Claude', 'claude'], ['DeepSeek', 'deepseek'], ['GPT', 'gpt'], ['Qwen', 'qwen'], ['Grok', 'grok'], ['Z.ai', 'zai'], ['Perplexity', 'perplexity'], ['Le Chat', 'lechat']];

const S = {};

S['1-task-card'] = schema(
  'Э0. Карточка задачи. В поле задачи — описание проблемы своими словами. Интервьюер задаёт вопросы по девяти полям, владелец отвечает, составитель собирает карточку, проверяющий ищет пустые и непроверяемые поля, владелец утверждает карточку.',
  [
    round('Опросник', [who('Claude', 'card', 'P01', 600, { label: 'Составитель карточки · Claude' })], { output: { document: 'form', format: 'json' } }),
    owner('interview', 'O-interview', { document: 'r1' }),
    round('Карточка задачи', [who('Claude', 'card', 'P02', 900, { label: 'Составитель карточки · Claude' })], { input: ['owner:interview'], output: doc('card', 'Карточка задачи') }),
    round('Проверка карточки', [who('GPT', 'cardcheck', 'P03', 600)], { input: [art('r2', 'card', 'card')] }),
    owner('card', 'O-card', { document: 'r2', input: ['r3'] }),
  ], 6000);

S['2-preflight'] = schema(
  'Э1. Предполёт. В поле задачи — карточка задачи. Проба знания у всех моделей, проверка способа проверки, три простых подхода и журнал отказов: где простые подходы ломаются на этой задаче.',
  [
    round('Проба знания', ALL.map(([name, id]) => who(name, `probe-${id}`, 'F01', 250)), { chat: 'new' }),
    round('Проверка способа проверки', [who('GPT', 'checkcheck', 'F06', 600)], { input: 'none', chat: 'new' }),
    round('Одиночное рассуждение', [who('Claude', 'solo', 'F02', 900)], { input: 'none', chat: 'new' }),
    round('Перебор', ALL.slice(0, 4).map(([name, id]) => who(name, `bon-${id}`, 'F03', 500)), { input: 'none', chat: 'new' }),
    round('Отбор', [who('Grok', 'picker', 'F04', 500)], { input: ['r4'], chat: 'new' }),
    round('Стандартный метод', [who('DeepSeek', 'naive', 'F05', 600)], { input: 'none', chat: 'new' }),
    round('Журнал отказов', [who('Le Chat', 'faillog', 'F07', 900)], { input: ['r1', 'r2', 'r3', 'r5', 'r6'], chat: 'new', output: doc('faillog', 'Журнал отказов') }),
    owner('preflight', 'O-preflight', { document: 'r7' }),
  ], 6000);

S['3-setup'] = schema(
  'Э2. Настройка. В поле задачи — карточка задачи и журнал отказов. Пробы барьера, конкурирующие диагнозы и их свод, конфигурация C0, поиск обходов правил, исправление, страница ратификации для подписи владельца.',
  [
    round('Пробы барьера', [who('Claude', 'probe1', 'D01', 500), who('DeepSeek', 'probe2', 'D01', 500)]),
    round('Диагноз барьера', [who('GPT', 'diag1', 'D02', 600), who('Qwen', 'diag2', 'D02', 600)], { input: ['r1'] }),
    round('Свод диагноза', [who('Perplexity', 'synth', 'D03', 700)], { input: ['r1', 'r2'] }),
    round('Конфигурация C0', [who('Claude', 'cfg', 'D04', 1500)], { input: ['r3'], output: doc('config', 'Конфигурация C0') }),
    round('Взлом правил', [who('Grok', 'breaker', 'D05', 800)], { input: [art('r4', 'cfg', 'config')] }),
    round('Исправление конфигурации', [who('Claude', 'cfg', 'D04b', 1700, { label: 'Сборщик конфигурации · Claude' })], {
      input: [art('r4', 'cfg', 'config'), 'r5'],
      output: { document: 'read', artifacts: [{ id: 'config', name: 'Конфигурация C0', pointer: '', revisionOf: art('r4', 'cfg', 'config') }] },
    }),
    round('Страница ратификации', [who('Le Chat', 'ratify', 'D06', 700)], { input: ['r3', art('r4', 'cfg', 'config'), 'r5'], output: doc('ratification', 'Страница ратификации') }),
    owner('ratify', 'O-ratify', { document: 'r7' }),
  ], 14000);

// Рабочий цикл. endless: без шагов владельца.
function cycle(endless) {
  const reg = art('r6', 'exp', 'registration');
  const lane = endless ? [] : ['owner:lane'];
  const recA = art('r15', 'rec1', 'records');
  const recB = art('r16', 'rec2', 'records');
  const map = art('r17', 'map', 'map');
  const steps = [
    round('План цикла', [who('Claude', 'coord', 'C01', 400)], { chat: 'new' }),
    round('Поиск', [who('Perplexity', 'search1', 'C02', 450), who('GPT', 'search2', 'C02', 450)], { input: ['r1'], chat: 'new' }),
    round('Факты', [who('Le Chat', 'src', 'C03', 450)], { input: ['r2'], chat: 'new' }),
    round('Гипотезы', [who('Claude', 'gen1', 'C04', 450), who('DeepSeek', 'gen2', 'C04', 450)], { input: ['r1', 'r3'], chat: 'new' }),
    round('Альтернативы', [who('Perplexity', 'alt', 'C05', 400)], { input: ['r4'], chat: 'new' }),
    round('Заявка на проверку', [who('DeepSeek', 'exp', 'C06', 700)], {
      input: ['r1', 'r4', 'r5'], chat: 'new',
      output: {
        format: 'json', requiredFields: ['/registration', '/procedure'],
        artifacts: [{ id: 'registration', name: 'Заявка: запись', pointer: '/registration' }, { id: 'procedure', name: 'Заявка: процедура', pointer: '/procedure' }],
      },
    }),
    round('Исполнение проверки', [blind('GPT', 'exec', 'C07', 700)], { input: [art('r6', 'exp', 'procedure')], chat: 'new' }),
    ...(endless ? [] : [owner('lane', 'O-lane', { input: ['r7'] })]),
    round('Слепая проверка', [blind('Qwen', 'chk1', 'C08', 300), blind('Grok', 'chk2', 'C08', 300), blind('Z.ai', 'chk3', 'C08', 300)], { input: [reg, 'r7', ...lane], chat: 'new' }),
    round('Расхождения', [who('Perplexity', 'dis', 'C09', 300)], { input: [reg, 'r7', 'r8'], chat: 'new' }),
    round('Диагноз метода', [who('Grok', 'diag', 'C10', 500)], { input: ['r1', 'r8', 'r9'], chat: 'new' }),
    round('Предложение: меню', [who('Claude', 'meth', 'C11', 600)], { input: ['r10'], chat: 'new' }),
    round('Предложение: ход', [who('DeepSeek', 'inv', 'C12', 600)], { input: ['r10'], chat: 'new' }),
    round('Плацебо', [who('Le Chat', 'plc', 'C13', 350)], { input: 'none', chat: 'new' }),
    round('Приёмка предложений', [who('Qwen', 'acc', 'C14', 350)], { input: ['r11', 'r12', 'r13'], chat: 'new' }),
    round('Записи цикла: исследование', [who('Le Chat', 'rec1', 'C15a', 900, { label: 'Секретарь журнала: исследование · Le Chat' })], {
      input: ['r1', 'r3', 'r4', reg, 'r7', ...lane, 'r8', 'r9'], chat: 'new',
      output: { artifacts: [{ id: 'records', name: 'Записи цикла: исследование', pointer: '' }] },
    }),
    round('Записи цикла: метод', [who('Le Chat', 'rec2', 'C15a', 600, { label: 'Секретарь журнала: метод · Le Chat' })], {
      input: [recA, 'r10', 'r11', 'r12', 'r13', 'r14'], chat: 'new',
      output: { artifacts: [{ id: 'records', name: 'Записи цикла: метод', pointer: '' }] },
    }),
    round('Карта вопроса', [who('Le Chat', 'map', 'C15b', 1300)], { input: [recA, recB], chat: 'new', output: doc('map', 'Карта вопроса') }),
    round('Контроль', [who('Perplexity', 'ctl', 'C16', 500)], { input: [reg, 'r8', recA, recB, map], chat: 'new' }),
    round('Сводка', [who('Claude', 'rep', 'C17', 400)], { input: [recA, recB, map, 'r18'], chat: 'new', output: doc('digest', 'Сводка') }),
    ...(endless ? [] : [owner('window', 'O-window', { document: 'r17', input: ['r18', 'r19'] })]),
  ];
  return schema(
    endless
      ? 'Э3. Рабочий цикл для непрерывного режима: без шагов владельца. В поле задачи — пакет цикла: ЯДРО, КОНФИГУРАЦИЯ, КАРТА ВОПРОСА. Ручное задание становится пробелом в карте; решения владельца принимаются на чекпоинте.'
      : 'Э3. Рабочий цикл. В поле задачи — пакет цикла: ЯДРО, КОНФИГУРАЦИЯ, КАРТА ВОПРОСА. План, поиск, гипотезы, заявка с предсказанием, исполнение проверки, слепая проверка, диагноз метода и предложения изменения, записи, карта вопроса, контроль, сводка, окно решений владельца.',
    steps);
}
S['4-cycle'] = cycle(false);
S['4-cycle-endless'] = cycle(true);

S['5-rebuild'] = schema(
  'Э4. Перестройка: сборка. В поле задачи — пакет цикла и текст выбранного предложения изменения. Сборщик вносит одно изменение в конфигурацию, проверяющий сверяет, владелец подписывает.',
  [
    round('Новая конфигурация', [who('Claude', 'asm', 'M01', 1800)], { output: doc('config', 'Конфигурация') }),
    round('Проверка изменения', [who('Qwen', 'diffcheck', 'M02', 400)], { input: [art('r1', 'asm', 'config')], chat: 'new' }),
    owner('sign', 'O-sign', { document: 'r1', input: ['r2'] }),
  ], 15000);

S['6-rebuild-verdict'] = schema(
  'Э4. Перестройка: суд. В поле задачи — предложение изменения, итоги плеч испытания (прежняя конфигурация, новая, плацебо) и измеренный шум. Судья сверяет предсказание с исходом, библиотекарь записывает перестройку, владелец решает.',
  [
    round('Суд', [who('GPT', 'judge', 'M03', 600)], { chat: 'new' }),
    round('Запись библиотеки', [who('Le Chat', 'lib', 'M04', 600)], { input: ['r1'], output: doc('rebuild', 'Запись библиотеки') }),
    owner('rebuild', 'O-rebuild', { document: 'r2', input: ['r1'] }),
  ]);

S['7-calibration'] = schema(
  'Э5. Калибровка проверяющих. В поле задачи — выборка корпуса порч без ответов. Проверяющие размечают выборку, владелец вставляет ключ, счётчик считает два числа каждому.',
  [
    round('Разметка', [who('Qwen', 'chk1', 'R03', 800), who('Grok', 'chk2', 'R03', 800), who('Z.ai', 'chk3', 'R03', 800)], { chat: 'new' }),
    owner('key', 'O-key'),
    round('Два числа', [who('Le Chat', 'counter', 'R04', 600)], { input: ['r1', 'owner:key'] }),
    owner('calibration', 'O-calibration', { input: ['r2'] }),
  ], 20000);

S['8-audit'] = schema(
  'Э5. Аудит и красная команда. В поле задачи — пакет цикла и выборка принятых выводов: заявки и сырые результаты без вердиктов. Аудитор перепроверяет выводы вслепую, красная команда ищет, где система обманывает себя.',
  [
    round('Аудит', [who('Z.ai', 'auditor', 'R02', 800)], { chat: 'new' }),
    round('Красная команда', [who('Grok', 'red', 'R01', 900)], { input: 'none', chat: 'new' }),
    owner('audit', 'O-audit', { input: ['r1', 'r2'] }),
  ], 20000);

S['9-exit'] = schema(
  'Э6. Выход. В поле задачи — пакет последнего цикла и перечень вердиктов. Проверка новизны, итог, проверка итога, утверждение владельцем, пост-мортем.',
  [
    round('Новизна', [who('Perplexity', 'nov1', 'X01', 700), who('GPT', 'nov2', 'X01', 700)]),
    round('Итог', [who('Claude', 'final', 'X02', 1200)], { input: ['r1'], output: doc('final', 'Итог') }),
    round('Проверка итога', [who('Qwen', 'finalcheck', 'X03', 500)], { input: [art('r2', 'final', 'final')], chat: 'new' }),
    owner('final', 'O-final', { document: 'r2', input: ['r3'] }),
    round('Пост-мортем', [who('DeepSeek', 'postmortem', 'X04', 900)], { input: [art('r2', 'final', 'final'), 'r3'] }),
  ], 16000);

S['10-polygon'] = schema(
  'Э5. Задачи полигона. В поле задачи — заказ: семейство задач, область, число, сложность. Генератор строит задачи со скрытой структурой, проверяющий ищет, чем они негодны, владелец раскладывает по наборам.',
  [
    round('Задачи', [who('Perplexity', 'world', 'R05', 2000)], { output: { format: 'json', requiredFields: ['/tasks'] } }),
    round('Проверка задач', [who('Le Chat', 'worldcheck', 'R06', 800)], { input: ['r1'] }),
    owner('polygon', 'O-polygon', { input: ['r1', 'r2'] }),
  ], 3000);

S['11-methodology-review'] = schema(
  'Рецензия методологии. В поле задачи — текст одного документа методологии. Четыре рецензента независимо ищут дыры в формате «утверждение, проверка, следствие»; автор принимает только доказанные замечания и готовит патч; владелец утверждает.',
  [
    round('Рецензия', [who('GPT', 'rev1', 'V01', 800), who('Qwen', 'rev2', 'V01', 800), who('DeepSeek', 'rev3', 'V01', 800), who('Grok', 'rev4', 'V01', 800)], { chat: 'new' }),
    round('Патч', [who('Claude', 'patch', 'V02', 1500)], { input: ['r1'], output: doc('patch', 'Патч') }),
    owner('patch', 'O-patch', { document: 'r2' }),
  ], 16000);

// --- Проверка и запись ---
const problems = [];

// Оценка наибольшего запроса шага: задача + вход + задание + общие правила.
function estimate(name, { doc: schemaDoc, taskLimit }) {
  const words = {}; // «шаг/участник» → предел слов
  const stepWords = {}; // шаг → сумма пределов
  for (const step of schemaDoc.steps) {
    if (step.kind === 'owner') { stepWords[step.ref] = 150; continue; }
    stepWords[step.ref] = 0;
    for (const model of step.models) {
      words[`${step.ref}/${model.id}`] = model.maxWords;
      stepWords[step.ref] += model.maxWords;
    }
  }
  schemaDoc.steps.forEach((step, index) => {
    if (step.kind === 'owner') return;
    const input = step.input ?? (index === 0 ? 'none' : 'previous');
    let incoming = 0;
    if (Array.isArray(input)) {
      for (const source of input) {
        if (typeof source === 'string') incoming += stepWords[source];
        else if (source.artifact) incoming += words[`${source.artifact.step}/${source.artifact.participant}`];
      }
    } else if (input === 'previous') {
      incoming = stepWords[schemaDoc.steps[index - 1].ref] || 0;
    }
    for (const model of step.models) {
      const own = (model.request || step.task).length;
      const total = (model.request ? 0 : taskLimit + COMMON.length) + incoming * CHARS_PER_WORD + own;
      if (total > REQUEST_BUDGET) problems.push(`${name} ${step.ref}/${model.id}: запрос до ${total} знаков, предел ${REQUEST_BUDGET}`);
    }
  });
}

fs.mkdirSync(outDir, { recursive: true });
for (const [name, built] of Object.entries(S)) {
  const errors = BasicSchema.validate(built.doc);
  if (errors.length) problems.push(`${name}: ${JSON.stringify(errors)}`);
  estimate(name, built);
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(built.doc, null, 2) + '\n');
  const notes = BasicSchema.warnings(built.doc);
  const rounds = built.doc.steps.filter((step) => step.kind === 'round').length;
  console.log(`${name}: шагов моделей ${rounds}, шагов владельца ${built.doc.steps.length - rounds}${notes.length ? `, замечаний ${notes.length}: ${JSON.stringify(notes)}` : ''}`);
}

const unused = Object.keys(prompts).filter((code) => !used.has(code));
if (unused.length) problems.push(`Запросы не вошли ни в одну схему: ${unused.join(', ')}`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Запросов: ${Object.keys(prompts).length}. Схем: ${Object.keys(S).length}. Ошибок нет.`);
