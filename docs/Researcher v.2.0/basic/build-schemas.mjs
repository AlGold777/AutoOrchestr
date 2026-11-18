// Собирает схемы Basic из запросов папки ../prompts и проверяет их валидатором Basic.
// Запуск из корня проекта: node "docs/Researcher v.2.0/basic/build-schemas.mjs"
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
const PACKAGE_LIMIT = 14000; // знаков: предел пакета цикла (текст задачи)
const CHARS_PER_WORD = 8;
const OVERRUN = 1.25; // модели превышают предел слов; строгая длина у шага снимает запас
const REQUEST_BUDGET = 52000;
const OWNER_WORDS = { choice: 700 }; // ответ владельца длиннее обычного: в нём конфигурация

const art = (step, participant, id) => ({ artifact: { step, participant, id }, version: 'latest', required: true });
const doc = (id, name) => ({ document: 'read', artifacts: [{ id, name, pointer: '' }] });
// Состав текущей схемы: код роли и модель. Нужен для проверки независимости.
let cast = [];
// Участник: модель, ID, код запроса, предел слов, прочее.
const who = (name, id, code, maxWords, extra = {}) => {
  cast.push({ code, name });
  return { name, id, label: `${titles[code]} · ${name}`, code, maxWords, ...extra };
};
// Участник, который не получает текст задачи: только вход и задание.
const blind = (name, id, code, maxWords) => {
  cast.push({ code, name });
  return { name, id, label: `${titles[code]} · ${name}`, request: `${P(code)}\n\nВходные данные:\n{вход}`, maxWords };
};
// Раунд: общий запрос участников становится заданием шага.
const round = (title, models, extra = {}) => {
  const codes = [...new Set(models.map((model) => model.code).filter(Boolean))];
  if (codes.length > 1) throw new Error(`В раунде «${title}» разные запросы: ${codes.join(', ')}`);
  const clean = models.map(({ code, ...model }) => model);
  return { kind: 'round', title, ...(codes.length ? { task: P(codes[0]) } : {}), models: clean, ...extra };
};
const owner = (id, code, extra = {}) => ({ ref: `owner:${id}`, kind: 'owner', models: [], task: P(code), ...extra });

function schema(description, steps, taskLimit = PACKAGE_LIMIT, runExtra = {}) {
  let n = 0;
  const numbered = steps.map((step) => (step.kind === 'round' ? { ref: `r${++n}`, ...step } : step));
  const built = {
    doc: {
      schemaVersion: 2,
      origin: 'user',
      description,
      run: { policy: 'auto', maxWords: 1000, ...runExtra },
      defaults: { discipline: { limit: 'Объём ответа — не больше {слов} слов.', content: COMMON } },
      steps: numbered,
    },
    taskLimit,
    cast,
  };
  cast = [];
  return built;
}

// --- Независимость ролей: одна модель не играет обе стороны пары (system/05-roles.md, §1) ---
const APART = [
  [['C04', 'C06'], ['C07', 'C08'], 'автор гипотезы или заявки не исполняет и не судит проверку'],
  [['C07'], ['C08'], 'исполнитель проверки не выносит вердикт'],
  [['C15a', 'C15b', 'C15c'], ['C01', 'C04', 'C05', 'C06', 'C07', 'C08'], 'секретарь журнала не сторона: не автор, не исполнитель, не проверяющий'],
  [['C16a', 'C16b'], ['C15a', 'C15b', 'C15c'], 'контролёр не проверяет собственные записи'],
  [['C16a', 'C16b'], ['C04', 'C06', 'C07', 'C08'], 'контролёр не автор, не исполнитель и не проверяющий'],
  [['M05', 'M06'], ['M07', 'M01', 'M02', 'M03'], 'автор перестройки не принимает, не собирает, не сверяет и не считает её'],
  [['M08'], ['M05', 'M06', 'M02'], 'автор контрольного изменения не автор перестройки и не сверяющий'],
  [['X02'], ['X03'], 'составитель итога не проверяет итог'],
  [['R05'], ['R06'], 'составитель задач полигона не проверяет их'],
  [['R03'], ['R04'], 'калибруемый не считает калибровку'],
];

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
    round('Проба знания', ALL.map(([name, id]) => who(name, `probe-${id}`, 'F01', 200)), { chat: 'new' }),
    round('Проверка способа проверки', [who('GPT', 'checkcheck', 'F06', 500)], { input: 'none', chat: 'new' }),
    round('Одиночное рассуждение', [who('Claude', 'solo', 'F02', 800)], { input: 'none', chat: 'new' }),
    round('Перебор', ALL.slice(0, 4).map(([name, id]) => who(name, `bon-${id}`, 'F03', 500)), { input: 'none', chat: 'new' }),
    round('Отбор', [who('Grok', 'picker', 'F04', 400)], { input: ['r4'], chat: 'new' }),
    round('Стандартный метод', [who('DeepSeek', 'naive', 'F05', 500)], { input: 'none', chat: 'new' }),
    round('Журнал отказов', [who('Le Chat', 'faillog', 'F07', 900)], { input: ['r1', 'r2', 'r3', 'r5', 'r6'], chat: 'new', output: doc('faillog', 'Журнал отказов') }),
    owner('preflight', 'O-preflight', { document: 'r7' }),
  ], 6000);

S['3-setup'] = schema(
  'Э2. Настройка. В поле задачи — карточка задачи, журнал отказов и выдержка библиотеки прошлых задач, если она есть. Пробы барьера, конкурирующие диагнозы и их свод, конфигурация C0, поиск обходов правил, исправление, страница ратификации для подписи владельца.',
  [
    round('Пробы барьера', [who('Claude', 'probe1', 'D01', 500), who('DeepSeek', 'probe2', 'D01', 500)]),
    round('Диагноз барьера', [who('GPT', 'diag1', 'D02', 600), who('Qwen', 'diag2', 'D02', 600)], { input: ['r1'] }),
    round('Свод диагноза', [who('Perplexity', 'synth', 'D03', 700)], { input: ['r1', 'r2'] }),
    round('Конфигурация C0', [who('Claude', 'cfg', 'D04', 900)], { input: ['r3'], output: doc('config', 'Конфигурация C0') }),
    round('Взлом правил', [who('Grok', 'breaker', 'D05', 800)], { input: [art('r4', 'cfg', 'config')] }),
    round('Исправление конфигурации', [who('Claude', 'cfg', 'D04b', 1100, { label: 'Сборщик конфигурации · Claude' })], {
      input: [art('r4', 'cfg', 'config'), 'r5'],
      output: { document: 'read', artifacts: [{ id: 'config', name: 'Конфигурация C0', pointer: '', revisionOf: art('r4', 'cfg', 'config') }] },
    }),
    // Страница собирается по исправленной конфигурации (r6), а не по черновику (r4).
    round('Страница ратификации', [who('Le Chat', 'ratify', 'D06', 700)], { input: ['r3', art('r6', 'cfg', 'config'), 'r5'], output: doc('ratification', 'Страница ратификации') }),
    owner('ratify', 'O-ratify', { document: 'r7', input: [art('r6', 'cfg', 'config')] }),
  ], 16000);

// Рабочий цикл. endless: без шагов владельца.
function cycle(endless) {
  const reg = art('r6', 'exp', 'registration');
  const lane = endless ? [] : ['owner:lane'];
  const recA = art('r11', 'rec1', 'records');
  const recB = art('r12', 'rec2', 'records');
  const map = art('r14', 'map', 'map');
  const steps = [
    round('План цикла', [who('Claude', 'coord', 'C01', 400)], { chat: 'new' }),
    round('Поиск', [who('Perplexity', 'search1', 'C02', 400), who('GPT', 'search2', 'C02', 400)], { input: ['r1'], chat: 'new' }),
    round('Факты', [who('Le Chat', 'src', 'C03', 450)], { input: ['r2'], chat: 'new' }),
    round('Гипотезы', [who('Claude', 'gen1', 'C04', 400), who('DeepSeek', 'gen2', 'C04', 400)], { input: ['r1', 'r3'], chat: 'new' }),
    round('Альтернативы', [who('Perplexity', 'alt', 'C05', 400)], { input: ['r4'], chat: 'new' }),
    round('Заявка на проверку', [who('DeepSeek', 'exp', 'C06', 600)], {
      input: ['r1', 'r4', 'r5'], chat: 'new',
      output: {
        format: 'json', requiredFields: ['/registration', '/procedure', '/note'],
        artifacts: [{ id: 'registration', name: 'Заявка: запись', pointer: '/registration' }, { id: 'procedure', name: 'Заявка: процедура', pointer: '/procedure' }],
      },
    }),
    round('Исполнение проверки', [blind('GPT', 'exec', 'C07', 600)], { input: [art('r6', 'exp', 'procedure')], chat: 'new' }),
    ...(endless ? [] : [owner('lane', 'O-lane', { input: ['r7'] })]),
    round('Слепая проверка', [blind('Qwen', 'chk1', 'C08', 250), blind('Grok', 'chk2', 'C08', 250), blind('Z.ai', 'chk3', 'C08', 250)], { input: [reg, 'r7', ...lane], chat: 'new' }),
    round('Расхождения', [blind('Perplexity', 'dis', 'C09', 250)], { input: [reg, 'r7', ...lane, 'r8'], chat: 'new' }),
    round('Диагноз метода', [who('Grok', 'diag', 'C10', 400)], { input: ['r1', 'r8', 'r9'], chat: 'new' }),
    round('Записи цикла: поиск', [who('Le Chat', 'rec1', 'C15a', 900)], {
      input: ['r1', 'r3', 'r4', 'r5'], chat: 'new',
      output: { artifacts: [{ id: 'records', name: 'Записи цикла: поиск', pointer: '' }] },
    }),
    // Секретарь получает ответ r6 целиком: в нём заметка автора с утверждением, которой нет у проверяющих.
    round('Записи цикла: проверка', [who('Le Chat', 'rec2', 'C15c', 700)], {
      input: ['r6', 'r7', ...lane, 'r8', 'r9', 'r10'], chat: 'new',
      output: { artifacts: [{ id: 'records', name: 'Записи цикла: проверка', pointer: '' }] },
    }),
    // Контроль записей — до карты: его донесение входит в карту и переходит в следующий цикл.
    round('Контроль записей', [blind('Perplexity', 'ctl1', 'C16a', 450)], { input: [reg, 'r7', ...lane, 'r8', 'r9', recB], chat: 'new' }),
    round('Карта вопроса', [who('Le Chat', 'map', 'C15b', 900)], { input: [recA, recB, 'r13'], chat: 'new', output: doc('map', 'Карта вопроса') }),
    round('Контроль карты', [who('Perplexity', 'ctl2', 'C16b', 300)], { input: [recA, recB, 'r13', map], chat: 'new' }),
    round('Сводка', [who('Claude', 'rep', 'C17', 400)], { input: [recB, map, 'r13', 'r15'], chat: 'new', output: doc('digest', 'Сводка') }),
    ...(endless ? [] : [owner('window', 'O-window', { document: 'r14', input: ['r13', 'r15', 'r16'] })]),
  ];
  return schema(
    endless
      ? 'Э3. Рабочий цикл для непрерывного режима: без шагов владельца. В поле задачи — пакет цикла: ЯДРО, ХОД, КОНФИГУРАЦИЯ, КАРТА ВОПРОСА. Ручное задание становится пробелом в карте; решения владельца принимаются на чекпоинте.'
      : 'Э3. Рабочий цикл. В поле задачи — пакет цикла: ЯДРО, ХОД, КОНФИГУРАЦИЯ, КАРТА ВОПРОСА. План, поиск, гипотезы, заявка с предсказанием, исполнение проверки, слепая проверка, диагноз метода, записи, контроль записей, карта вопроса, контроль карты, сводка, окно решений владельца.',
    steps,
    PACKAGE_LIMIT,
    endless
      ? {
        stopMarks: ['ТРЕВОГА:', 'СТОП:', 'ЦИКЛ НЕ ВЫПОЛНЯЕТСЯ'],
        onNoAnswer: 'skip',
        repeat: {
          carry: { step: 'r14', participant: 'map', artifact: 'map' },
          carryMarker: '=== КАРТА ВОПРОСА ===',
          maxPasses: 10,
          maxRequests: 250,
          ownerEvery: 5,
          carryMaxChars: 7500,
        },
      }
      : { stopMarks: ['ЦИКЛ НЕ ВЫПОЛНЯЕТСЯ'] },
  );
}
S['4-cycle'] = cycle(false);
S['4-cycle-endless'] = cycle(true);

S['5-rebuild'] = schema(
  'Э4. Перестройка: предложения и сборка. В поле задачи — пакет цикла, ответ диагноста метода, выдержка библиотеки перестроек и заметка «взгляд извне», если она есть. Методист и изобретатель предлагают изменение, приёмщик проверяет форму, владелец выбирает и задаёт пункт контрольного изменения, сборщик собирает две конфигурации — новую и контрольную, проверяющий сверяет, владелец подписывает.',
  [
    round('Предложение: меню', [who('Claude', 'meth', 'M05', 600)], { input: 'none', chat: 'new' }),
    round('Предложение: ход', [who('DeepSeek', 'inv', 'M06', 700)], { input: 'none', chat: 'new' }),
    round('Приёмка предложений', [who('Qwen', 'acc', 'M07', 350)], { input: ['r1', 'r2'], chat: 'new' }),
    owner('choice', 'O-choice', { input: ['r1', 'r2', 'r3'] }),
    round('Контрольное изменение', [blind('Le Chat', 'plc', 'M08', 450)], { input: ['owner:choice'], chat: 'new' }),
    round('Новая конфигурация', [who('Z.ai', 'asm', 'M01', 900)], { input: ['r1', 'r2', 'owner:choice'], chat: 'new', output: doc('config', 'Конфигурация: новая') }),
    round('Контрольная конфигурация', [who('Z.ai', 'asmk', 'M01', 900, { label: 'Сборщик контрольной конфигурации · Z.ai' })], { input: ['r4', 'owner:choice'], chat: 'new', output: doc('config', 'Конфигурация: контрольная') }),
    round('Проверка изменений', [blind('Qwen', 'diffcheck', 'M02', 450)], { input: ['r1', 'r2', 'owner:choice', 'r4', art('r5', 'asm', 'config'), art('r6', 'asmk', 'config')], chat: 'new' }),
    owner('sign', 'O-sign', { document: 'r5', input: [art('r6', 'asmk', 'config'), 'r7'] }),
  ], 20000);

S['6-rebuild-verdict'] = schema(
  'Э4. Перестройка: счёт. В поле задачи — предсказание и условие отката из предложения, сводки циклов каждого плеча под именами А, Б, В и измеренный шум. Два счётчика независимо считают показатели плеч, владелец выносит вердикт по правилу, записанному до испытания, библиотекарь записывает перестройку.',
  [
    round('Счёт плеч', [who('GPT', 'count1', 'M03', 450), who('Grok', 'count2', 'M03', 450)], { chat: 'new' }),
    owner('verdict', 'O-verdict', { input: ['r1'] }),
    round('Запись библиотеки', [who('Le Chat', 'lib', 'M04', 600)], { input: ['r1', 'owner:verdict'], chat: 'new', output: doc('rebuild', 'Запись библиотеки') }),
    owner('rebuild', 'O-rebuild', { document: 'r2' }),
  ], 32000);

S['7-calibration'] = schema(
  'Э5. Калибровка проверяющих. В поле задачи — выборка корпуса порч без ответов. Проверяющие размечают выборку, владелец вставляет ключ, счётчик сверяет построчно, владелец пересчитывает числа и записывает их в журнал.',
  [
    round('Разметка', [who('Qwen', 'chk1', 'R03', 800), who('Grok', 'chk2', 'R03', 800), who('Z.ai', 'chk3', 'R03', 800)], { chat: 'new' }),
    owner('key', 'O-key'),
    round('Сверка с ключом', [blind('Le Chat', 'counter', 'R04', 800)], { input: ['r1', 'owner:key'], chat: 'new' }),
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
    // Пост-мортем читает итог после правки владельца, а не черновик r2.
    round('Пост-мортем', [who('DeepSeek', 'postmortem', 'X04', 900)], { input: ['owner:final', 'r3'] }),
  ], 16000);

S['10-polygon'] = schema(
  'Э5. Задачи полигона. В поле задачи — заказ: семейство задач, область, число, сложность. Генератор строит задачи со скрытой структурой, проверяющий ищет, чем они негодны, владелец меняет параметры, пересчитывает ответы и раскладывает по наборам.',
  [
    round('Задачи', [who('Perplexity', 'world', 'R05', 2000)], { output: { format: 'json', requiredFields: ['/tasks'] } }),
    round('Проверка задач', [who('Le Chat', 'worldcheck', 'R06', 800)], { input: ['r1'] }),
    owner('polygon', 'O-polygon', { input: ['r1', 'r2'] }),
  ], 3000);

S['11-methodology-review'] = schema(
  'Рецензия методологии. В поле задачи — текст одного документа методологии. Четыре рецензента независимо ищут дыры в формате «утверждение, проверка, следствие»; автор принимает только доказанные замечания и готовит патч; владелец утверждает.',
  [
    round('Рецензия', [who('GPT', 'rev1', 'V01', 800), who('Qwen', 'rev2', 'V01', 800), who('DeepSeek', 'rev3', 'V01', 800), who('Grok', 'rev4', 'V01', 800)], { chat: 'new', output: { strictLength: true } }),
    round('Патч', [who('Claude', 'patch', 'V02', 1500)], { input: ['r1'], output: doc('patch', 'Патч') }),
    owner('patch', 'O-patch', { document: 'r2' }),
  ], 16000);

// --- Проверка и запись ---
const problems = [];

// Оценка наибольшего запроса шага: задача + вход + задание + общие правила.
// Вход считается с запасом: слово — 8 знаков, ответ длиннее предела на четверть. Шаг со строгой длиной запаса не требует.
function estimate(name, { doc: schemaDoc, taskLimit }) {
  const words = {}; // «шаг/участник» → предел слов с запасом
  const stepWords = {}; // шаг → сумма пределов с запасом
  for (const step of schemaDoc.steps) {
    if (step.kind === 'owner') { stepWords[step.ref] = OWNER_WORDS[step.ref.slice(6)] || 150; continue; }
    const factor = step.output?.strictLength === true ? 1 : OVERRUN;
    stepWords[step.ref] = 0;
    for (const model of step.models) {
      words[`${step.ref}/${model.id}`] = model.maxWords * factor;
      stepWords[step.ref] += model.maxWords * factor;
    }
  }
  let worst = 0;
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
      // Общие правила получает каждый участник; текст задачи — только участник без собственного запроса.
      const total = Math.round((model.request ? 0 : taskLimit) + COMMON.length + incoming * CHARS_PER_WORD + own);
      worst = Math.max(worst, total);
      if (total > REQUEST_BUDGET) problems.push(`${name} ${step.ref}/${model.id}: запрос до ${total} знаков, предел ${REQUEST_BUDGET}`);
    }
  });
  return worst;
}

// Независимость: ни одна модель не стоит по обе стороны пары из APART.
function independence(name, list) {
  const modelsOf = (codes) => new Set(list.filter((item) => codes.includes(item.code)).map((item) => item.name));
  for (const [left, right, why] of APART) {
    const other = modelsOf(right);
    for (const model of modelsOf(left)) {
      if (other.has(model)) problems.push(`${name}: ${model} играет ${left.join('/')} и ${right.join('/')} — ${why}`);
    }
  }
}

fs.mkdirSync(outDir, { recursive: true });
for (const [name, built] of Object.entries(S)) {
  const errors = BasicSchema.validate(built.doc);
  if (errors.length) problems.push(`${name}: ${JSON.stringify(errors)}`);
  const worst = estimate(name, built);
  independence(name, built.cast);
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(built.doc, null, 2) + '\n');
  const notes = BasicSchema.warnings(built.doc);
  const rounds = built.doc.steps.filter((step) => step.kind === 'round').length;
  const requests = built.doc.steps.reduce((sum, step) => sum + (step.kind === 'round' ? step.models.length : 0), 0);
  console.log(`${name}: шагов моделей ${rounds}, запросов ${requests}, шагов владельца ${built.doc.steps.length - rounds}, наибольший запрос ${worst} знаков (${Math.round(worst / REQUEST_BUDGET * 100)}% предела)${notes.length ? `, замечаний ${notes.length}: ${JSON.stringify(notes)}` : ''}`);
}

const unused = Object.keys(prompts).filter((code) => !used.has(code));
if (unused.length) problems.push(`Запросы не вошли ни в одну схему: ${unused.join(', ')}`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(`Запросов: ${Object.keys(prompts).length}. Схем: ${Object.keys(S).length}. Ошибок нет.`);
