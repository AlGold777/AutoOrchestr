// Стенд схем прототипа холста Basic: клавиша I (или Ш) открывает окно вставки JSON-схемы этапов,
// «Применить» проверяет схему и перерисовывает холст по ней. Этапы моделей схемы (раунды) кладутся в
// window.ProtoState, поэтому их окна — настоящие окна cards.js; остальные блоки — окна «Из схемы».
// Холст (canvas.js) отдаёт отрисовку сюда, пока ProtoStand.active; «Сбросить» возвращает исходный холст.
// Каталог шаблонов: Save сохраняет применённую схему шаблоном в JSON-файл на компьютере; шаблоны — пункты списка Pipelines.
(function initProtoStand(root) {
  'use strict';

  const STAND_VERSION = '63';
  const S = () => root.ProtoState;
  const cards = () => root.ProtoCards || {};
  const canvas = () => root.ProtoCanvas || {};
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const own = (value) => typeof value === 'string' && Boolean(value.trim());
  // Подсказка элемента холста: data-tip — название, data-desc — описание (из схемы); пусто в схеме — видимая строка.
  const NO_DESC = 'Описание не задано';
  const tipAttrs = (name, desc) => ` data-tip="${esc(name)}" data-desc="${esc(own(desc) ? desc.trim() : NO_DESC)}"`;
  const cut = (text, n) => { const s = String(text || '').trim().replace(/\s+/g, ' '); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  // ---------- Формат схемы ----------
  const COMMON = ['id', 'block', 'title', 'inputs', 'artifacts', 'why'];
  const FIELDS = {
    round: ['models', 'task', 'chat'], owner: ['ask', 'document'], file: ['file', 'mode']
  };
  // Виды этапов, которых больше нет: в схеме их выражают обычными этапами (текст ошибки — в проверке).
  const REMOVED_BLOCKS = {
    gate: 'Проверка — обычный этап моделей: критерии запишите в task, затем поставьте этап owner: User читает вердикт и решает, нужна ли доработка',
    block: 'Готовой части нет: этап записывается обычным образом',
    synthesis: 'Синтез — это роль: запишите этап round из одной модели с role «свести» (models: [{ "name": "Claude", "role": "свести" }])',
    form: 'Опросник — round из одной модели с ролью «свести» и артефактом «Опросник» (HTML), затем owner с артефактом «Ответы»',
    source: 'Исходный материал — верхнеуровневый artifacts (name и content или attachment), ссылка в inputs: «in.Имя»',
    route: 'Ветвления в схеме нет: все этапы выполняются по порядку. Если нужно решение User — поставьте этап owner с вопросом ask, а следующий этап читает его ответ'
  };
  // Поля, которых больше нет: значение игнорируется, проверка предупреждает.
  const REMOVED_FIELDS = {
    request: 'Свой запрос не записывается: задание пишется в task'
  };
  // Блоки, где работает User: в холсте — зелёная рамка, в окне — «Назначение».
  const HUMAN_BLOCKS = ['owner'];
  const KIND = {
    round: ['Раунд', 'ti-users'],
    owner: ['Ответ User', 'ti-user'], file: ['Файл', 'ti-file-export']
  };
  // Этапы приложения (без нейросети): в холсте помечаются словом «приложение».
  const APP_BLOCKS = ['file'];
  const MODEL_KEYS = ['name', 'role', 'task', 'maxWords', 'discipline', 'enabled'];
  const MODEL_NAMES = ['Claude', 'GPT', 'Gemini', 'Grok', 'Le Chat', 'Qwen', 'DeepSeek', 'Perplexity', 'Z.ai', 'Kimi'];
  const ENUMS = { mode: ['overwrite', 'append'], chat: ['new', 'continue'] };
  const LABELS = {
    id: 'этап', block: 'блок', title: 'название', why: 'зачем', inputs: 'вход', artifacts: 'артефакты',
    models: 'модели', task: 'задание', model: 'модель', role: 'роль', ask: 'вопрос',
    file: 'файл', mode: 'режим', maxWords: 'предел слов', discipline: 'дисциплина',
    defaults: 'общие значения ▶', run: 'запуск'
  };
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const DISC_LABELS = { limit: 'длина', content: 'содержание', delivery: 'доставка', correction: 'повторный запрос', lines: 'строки' };
  const POLICY_TEXT = { auto: 'автоматически', manual: 'вручную' };
  // Роли окна модели (cards.js, ROLES) по словам схемы.
  const ROLE_IDS = [
    [/свод|свести|синтез|synth/i, 'interaction_meta_synthesis'],
    [/крит|аудит|critique/i, 'interaction_critical_audit'],
    [/отобр|идеи|select/i, 'interaction_select_ideas'],
    [/групп|кластер|cluster/i, 'interaction_pattern_clustering']
  ];
  const ROLE_OPTIONS = [['None', 'None'], ['interaction_meta_synthesis', 'Synthes'], ['interaction_critical_audit', 'Critique'],
    ['interaction_select_ideas', 'Select ideas'], ['interaction_pattern_clustering', 'Clustering'], ['custom', 'Custom']];
  const roleIdOf = (text) => (own(text) ? (ROLE_IDS.find(([re]) => re.test(text))?.[1] || '') : '');

  const refId = (ref) => String(ref).split('.')[0];
  const listOf = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value]);

  // ---------- Чтение ответа модели ----------
  // Модели присылают JSON в обёртке (```json … ```, текст до и после), «мягкий» JSON, оборванный ответ,
  // Mermaid или внутреннее состояние прототипа. Однозначно исправимое исправляется с замечанием, остальное — ошибка.
  const isObj = (value) => !!value && typeof value === 'object' && !Array.isArray(value);
  // Артефакт этапа: строка (имя) или объект { name, description }. Имя и описание читаются через эти хелперы.
  const artName = (a) => (isObj(a) ? String(a.name ?? '') : String(a ?? '')).trim();
  const artDesc = (a) => (isObj(a) && typeof a.description === 'string' ? a.description.trim() : '');
  const STATE_MSG = 'Это не схема, а внутреннее состояние прототипа (rounds, models…). Попросите ответ в формате { "task": …, "steps": […] }.';
  const QUOTES = { '"': '"', '“': '”“', '”': '”“', '„': '“”', "'": "'", '‘': '’‘', '’': '’‘' };
  const KEY_START = /[A-Za-z_$Ѐ-ӿ]/;
  const KEY_CHAR = /[A-Za-z0-9_$Ѐ-ӿ]/;
  // Проходит одно JSON-значение от s[from] и переписывает его в строгий JSON: кавычки, комментарии, хвостовые запятые,
  // ключи без кавычек. Содержимое строк не меняется (только экранируется). closed = false — значение не закончилось.
  function soften(s, from) {
    let out = '';
    let i = from;
    const stack = [];
    const fixes = new Set();
    const closes = [];
    const result = (closed) => ({ out, closed, end: i, fixes, closes });
    while (i < s.length) {
      const ch = s[i];
      if (QUOTES[ch]) {
        const ends = QUOTES[ch];
        if (ch !== '"') fixes.add(ch === "'" ? 'одинарные кавычки → двойные' : 'типографские кавычки → обычные');
        let j = i + 1;
        let body = '';
        while (j < s.length && !ends.includes(s[j])) {
          const c = s[j];
          if (c === '\\' && j + 1 < s.length) { body += ch !== '"' && s[j + 1] === "'" ? "'" : c + s[j + 1]; j += 2; continue; }
          if (c === '"' && ch !== '"') body += '\\"';
          else if (c === '\n') { body += '\\n'; fixes.add('перевод строки внутри строки → \\n'); }
          else if (c === '\t') { body += '\\t'; fixes.add('табуляция внутри строки → \\t'); }
          else if (c !== '\r') body += c;
          j++;
        }
        i = j;
        if (j >= s.length) return result(false);
        out += `"${body}"`;
        i = j + 1;
        continue;
      }
      if (ch === '/' && s[i + 1] === '/') { const nl = s.indexOf('\n', i); i = nl < 0 ? s.length : nl; fixes.add('комментарии удалены'); continue; }
      if (ch === '/' && s[i + 1] === '*') { const e = s.indexOf('*/', i + 2); i = e < 0 ? s.length : e + 2; fixes.add('комментарии удалены'); continue; }
      if (ch === '{' || ch === '[') { stack.push(ch === '{' ? '}' : ']'); out += ch; i++; continue; }
      if (ch === '}' || ch === ']') {
        const t = out.replace(/\s+$/, '');
        if (t.endsWith(',')) { out = t.slice(0, -1); fixes.add('хвостовые запятые удалены'); }
        stack.pop();
        out += ch;
        i++;
        closes.push({ at: out.length, ch, stack: stack.slice() });
        if (!stack.length) return result(true);
        continue;
      }
      if (KEY_START.test(ch)) {
        let j = i;
        while (j < s.length && KEY_CHAR.test(s[j])) j++;
        const word = s.slice(i, j);
        let k = j;
        while (k < s.length && /\s/.test(s[k])) k++;
        if (k >= s.length) { i = s.length; return result(false); } // слово оборвано концом ответа
        if (s[k] === ':') { out += JSON.stringify(word); fixes.add('ключи взяты в кавычки'); } else out += word;
        i = j;
        continue;
      }
      out += ch;
      i++;
    }
    return result(false);
  }
  const ALIASES_STEPS = ['stages', 'nodes', 'blocks'];
  const hasSteps = (o) => isObj(o) && ['steps', ...ALIASES_STEPS].some((k) => k in o);
  const isEndError = (message) => /end of JSON|Unterminated|Unexpected end/i.test(message || '');
  const errorOf = (text) => { try { JSON.parse(text); return null; } catch (error) { return error; } };
  // Последний полностью прочитанный этап оборванного ответа: закрываем скобки после каждого «}» этапа и пробуем разобрать.
  function lastFullStep(res) {
    for (let k = res.closes.length - 1; k >= 0; k--) {
      const c = res.closes[k];
      if (c.ch !== '}' || c.stack[c.stack.length - 1] !== ']' || c.stack.length > 3) continue;
      try {
        let v = JSON.parse(res.out.slice(0, c.at) + c.stack.slice().reverse().join(''));
        if (Array.isArray(v)) v = v[0];
        while (isObj(v) && !hasSteps(v) && Object.keys(v).length === 1) v = Object.values(v)[0];
        const list = isObj(v) ? v.steps || v.stages || v.nodes || v.blocks : null;
        const steps = Array.isArray(list) ? list : isObj(list) ? Object.keys(list) : [];
        const last = steps[steps.length - 1];
        const id = typeof last === 'string' ? last : last?.id;
        if (own(id)) return id;
      } catch (error) { /* следующая точка */ }
    }
    return '';
  }
  // Текст ответа → первое JSON-значение (или null с ошибкой в issues).
  // Служебные строки расширения-копировщика: метка [[AO-…]] и пометки [НЕ СКОПИРОВАНО: …] / [СКОПИРОВАНО: …].
  const SERVICE_LINE = /^\s*(?:\[\[AO-[^\]]*\]\]|\[(?:НЕ\s+)?СКОПИРОВАНО:.*\])\s*$/i;
  const commentOf = (text) => text.replace(/```\w*/g, '').trim();
  function readJson(text, add, ctx) {
    const lines = text.split('\n');
    const kept = lines.filter((line) => !SERVICE_LINE.test(line));
    if (kept.length < lines.length) add('warn', null, `Удалено служебных строк расширения: ${lines.length - kept.length}.`);
    const raw = kept.join('\n');
    if (!raw.trim()) { add('error', null, 'Поле пустое: вставьте JSON-схему { "task": …, "steps": […] }.'); return null; }
    if (/\bProtoState\b/.test(raw)) { add('error', null, STATE_MSG); return null; }
    const brace = raw.indexOf('{');
    const mermaid = /```\s*mermaid|^\s*(?:flowchart|graph)\s+(?:TD|TB|LR|RL|BT)\b|^\s*(?:sequenceDiagram|stateDiagram(?:-v2)?|classDiagram)\b/m.exec(raw);
    if (brace < 0 || (mermaid && mermaid.index < brace)) {
      add('error', null, `Получен ${mermaid ? 'Mermaid' : 'текст'}, а не JSON. Попросите у модели только JSON { "task": …, "steps": […] } без диаграмм и пояснений.`);
      return null;
    }
    const sq = raw.lastIndexOf('[', brace);
    const start = sq >= 0 && !raw.slice(sq + 1, brace).trim() ? sq : brace;
    const before = commentOf(raw.slice(0, start));
    ctx.comment = before;
    const first = soften(raw, start);
    if (!first.closed) {
      // Оборван: ошибка разбора — «конец ввода» или стоит в самом конце текста.
      const texts = [raw.slice(start), first.out];
      const messages = texts.map((t) => errorOf(t)?.message);
      const atEnd = messages.some((msg, k) => { const m = /position (\d+)/.exec(msg || ''); return m && Number(m[1]) >= texts[k].trimEnd().length - 1; });
      if (atEnd || messages.some(isEndError) || !messages[0]) {
        const id = lastFullStep(first);
        add('error', null, `Ответ оборван (модель остановилась на «…${cut(raw.trimEnd().slice(-60), 61)}»)${id ? `; последний полностью прочитанный этап — ${id}` : ''}. Попросите: «Продолжи с этого места» или сократите тексты заданий.`);
      } else add('error', null, `Неверный JSON: ${messages[0]}`);
      return null;
    }
    let value;
    const strict = errorOf(raw.slice(start, first.end));
    if (!strict) value = JSON.parse(raw.slice(start, first.end));
    else if (!errorOf(first.out)) {
      value = JSON.parse(first.out);
      add('warn', null, `JSON исправлен автоматически: ${[...first.fixes].join(', ') || 'мелкие ошибки записи'}.`);
    } else {
      const m = /position (\d+)/.exec(strict.message);
      const at = m ? start + Number(m[1]) : -1;
      add('error', null, `Неверный JSON: ${strict.message}${at >= 0 ? ` — около «${cut(raw.slice(Math.max(start, at - 30), at + 30), 60)}»` : ''}.`);
      return null;
    }
    // Хвост: ещё JSON-объекты или текст.
    let rest = raw.slice(first.end);
    let count = 1;
    for (;;) {
      const t = rest.replace(/^(?:[\s,;]|```\w*)*/, '');
      if (!t.startsWith('{')) break;
      const next = soften(t, 0);
      if (!next.closed || errorOf(next.out)) break;
      count++;
      rest = t.slice(next.end);
    }
    if (count > 1) add('warn', null, `Найдено ${count} JSON-объектов, применён первый.`);
    // Текст вне JSON — «Комментарий модели»: показывается целиком в блоке замечаний.
    ctx.comment = [before, commentOf(rest)].filter(Boolean).join('\n\n');
    if (ctx.comment) add('warn', null, 'Текст вне JSON сохранён как комментарий модели.');
    return value;
  }
  // Корень: обёртки, список, состояние прототипа, алиасы steps.
  function rootOf(value, add) {
    let v = value;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj);
      if (objs.length && objs.every((o) => !hasSteps(o)) && objs.some((o) => 'block' in o || 'id' in o)) {
        add('warn', null, 'Получен только список этапов — обёрнут в { "steps": […] }.');
        v = { steps: v };
      } else if (isObj(v[0])) {
        add('warn', null, `Корень — список из ${v.length} ${v.length === 1 ? 'объекта' : 'объектов'}, а не объект; применён первый.`);
        v = v[0];
      } else { add('error', null, 'Схема должна быть объектом { task, steps }, а получен список.'); return null; }
    }
    if (!isObj(v)) { add('error', null, 'Схема должна быть объектом { task, steps }.'); return null; }
    for (let guard = 0; guard < 3 && !hasSteps(v); guard++) {
      const keys = Object.keys(v);
      const w = ['schema', 'result', 'pipeline', 'data', 'output', 'json', 'response', 'answer'].find((k) => hasSteps(v[k]))
        || (keys.length === 1 && hasSteps(v[keys[0]]) ? keys[0] : null);
      if (!w) break;
      add('warn', null, `Схема была вложена в «${w}» — развёрнута.`);
      v = v[w];
    }
    if (!hasSteps(v) && ('rounds' in v || Array.isArray(v.models) || 'final' in v)) { add('error', null, STATE_MSG); return null; }
    if (!('steps' in v)) {
      const a = ALIASES_STEPS.find((k) => k in v);
      if (a) { v.steps = v[a]; delete v[a]; add('warn', null, `«${a}» вместо «steps» — переименовано.`); }
    }
    v.steps = mapToList(v.steps, 'steps', null, add);
    return v;
  }
  function mapToList(value, where, key, add) {
    if (!isObj(value) || !Object.keys(value).length || !Object.values(value).every(isObj)) return value;
    add('warn', key, `${where} был объектом { id: этап } — превращён в список.`);
    return Object.entries(value).map(([id, st]) => (st.id == null ? { id, ...st } : st));
  }
  // Заглушка: модель сократила ответ.
  const STUB = /^\s*(?:\.{2,}|…|todo|tbd|и\s*т\.\s*д\.?|etc\.?)\s*$|(?:…|\.\.\.)\s*$/i;
  function stubs(obj, path, key, add) {
    Object.entries(obj).forEach(([k, val]) => {
      const at = `${path}${k}`;
      if (typeof val === 'string' && STUB.test(val)) add('warn', key, `Заглушка вместо текста в поле ${at}: «${cut(val, 30)}» — модель сократила ответ.`);
      else if (Array.isArray(val)) val.forEach((x, i) => {
        if (typeof x === 'string' && STUB.test(x)) add('warn', key, `Заглушка вместо текста в поле ${at}[${i}]: «${cut(x, 30)}» — модель сократила ответ.`);
        else if (isObj(x)) stubs(x, `${at}[${i}].`, key, add);
      });
      else if (isObj(val)) stubs(val, `${at}.`, key, add);
    });
  }
  // Алиасы и формы полей этапа (не заменяют существующие правильные поля).
  function fixSteps(list, prefix, add) {
    if (!Array.isArray(list)) return;
    list.forEach((st, i) => {
      if (!isObj(st)) return;
      const key = own(st.id) ? st.id : `${prefix}[${i}]`;
      const fixed = (msg) => add('warn', key, msg);
      if (st.block == null) {
        const a = ['type', 'kind_of_block'].find((k) => typeof st[k] === 'string');
        if (a) { st.block = st[a]; delete st[a]; fixed(`«${a}» вместо «block» — переименовано.`); }
      }
      if (typeof st.block === 'string') {
        const b = st.block.trim().toLowerCase();
        if (b !== st.block && (has(FIELDS, b) || has(REMOVED_BLOCKS, b))) { fixed(`block «${st.block}» → «${b}».`); st.block = b; }
      }
      if (st.title == null && own(st.name)) { st.title = st.name; delete st.name; fixed('«name» вместо «title» — переименовано.'); }
      if (st.inputs == null) {
        const a = ['input', 'depends_on', 'requires'].find((k) => st[k] != null);
        if (a) { st.inputs = st[a]; delete st[a]; fixed(`«${a}» вместо «inputs» — переименовано.`); }
      }
      ['inputs', 'artifacts'].forEach((k) => { if (typeof st[k] === 'string') { st[k] = [st[k]]; fixed(`${k} строкой — превращён в список.`); } });
      if (Array.isArray(st.models) && st.models.some((m) => typeof m === 'string')) {
        st.models = st.models.map((m) => (typeof m === 'string' ? { name: m.trim() } : m));
        fixed('models списком имён — превращён в объекты { name }.');
      }
      stubs(st, '', key, add);
    });
  }
  // Новые поля: предел слов, дисциплина, defaults, run.
  const DISC_KEYS = ['limit', 'content', 'delivery', 'correction', 'lines'];
  const DEFAULTS_KEYS = ['roundTask', 'discipline', 'modelNotes'];
  const RUN_WORDS = [300, 500, 700, 1000];
  const wordsOf = (v) => {
    const n = typeof v === 'number' ? v : typeof v === 'string' && /^\s*\d+\s*$/.test(v) ? Number(v) : NaN;
    return Number.isSafeInteger(n) && n > 0 ? n : '';
  };
  function checkWords(owner, where, key, add) {
    const v = owner.maxWords;
    if (v == null || v === '') return;
    if (typeof v === 'string' && wordsOf(v)) { owner.maxWords = wordsOf(v); add('warn', key, `${where}maxWords «${v}» строкой — принят как число.`); return; }
    if (!wordsOf(v)) add('warn', key, `${where}maxWords «${v}» — ожидается положительное целое число слов; не применён.`);
  }
  function checkText(owner, k, where, key, add) {
    if (owner[k] != null && typeof owner[k] !== 'string') add('warn', key, `${where}${k} должен быть строкой; не применён.`);
  }
  function checkDiscipline(d, where, key, add) {
    if (d == null) return;
    if (!isObj(d)) { add('warn', key, `${where}discipline должен быть объектом { limit, content, delivery, correction, lines }; не применён.`); return; }
    Object.keys(d).forEach((k) => {
      if (!DISC_KEYS.includes(k)) add('warn', key, `${where}discipline.${k}: неизвестное поле; допустимы ${DISC_KEYS.join(', ')}.`);
      else if (k === 'lines') {
        if (typeof d.lines === 'string') { d.lines = [d.lines]; add('warn', key, `${where}discipline.lines строкой — превращён в список.`); }
        else if (!Array.isArray(d.lines) || d.lines.some((x) => typeof x !== 'string')) add('warn', key, `${where}discipline.lines должен быть списком строк.`);
      } else checkText(d, k, `${where}discipline.`, key, add);
    });
  }
  function checkRoot(schema, add) {
    const d = schema.defaults;
    if (d != null) {
      if (!isObj(d)) add('warn', null, 'defaults должен быть объектом { roundTask, discipline, modelNotes }; не применён.');
      else {
        Object.keys(d).filter((k) => !DEFAULTS_KEYS.includes(k)).forEach((k) => add('warn', null, `defaults.${k}: неизвестное поле; допустимы ${DEFAULTS_KEYS.join(', ')}.`));
        checkText(d, 'roundTask', 'defaults.', null, add);
        checkDiscipline(d.discipline, 'defaults.', null, add);
        if (d.modelNotes != null) {
          if (!isObj(d.modelNotes)) add('warn', null, 'defaults.modelNotes должен быть объектом { "Claude": "текст", … }; не применён.');
          else Object.entries(d.modelNotes).forEach(([n, v]) => {
            if (typeof v !== 'string') add('warn', null, `defaults.modelNotes.${n} должен быть строкой; не применён.`);
            if (!MODEL_NAMES.includes(n)) add('warn', null, `defaults.modelNotes: неизвестное имя модели «${n}»; допустимы: ${MODEL_NAMES.join(', ')}.`);
          });
        }
        stubs(d, 'defaults.', null, add);
      }
    }
    const r = schema.run;
    if (r != null) {
      if (!isObj(r)) add('warn', null, 'run должен быть объектом { policy, maxWords }; не применён.');
      else {
        Object.keys(r).filter((k) => !['policy', 'maxWords'].includes(k)).forEach((k) => add('warn', null, `run.${k}: неизвестное поле; допустимы policy, maxWords.`));
        if (r.policy != null && !['auto', 'manual'].includes(r.policy)) add('warn', null, `run.policy: «${r.policy}» — ожидается auto | manual; не применён.`);
        checkWords(r, 'run.', null, add);
        if (wordsOf(r.maxWords) && !RUN_WORDS.includes(wordsOf(r.maxWords))) add('warn', null, `run.maxWords: ${r.maxWords} — в шапке холста выбираются ${RUN_WORDS.join(' | ')}.`);
      }
    }
  }
  // Свои поля модели раунда и синтеза.
  function checkOwnFields(owner, where, key, add) {
    checkWords(owner, where, key, add);
    checkDiscipline(owner.discipline, where, key, add);
    if (owner.enabled != null && typeof owner.enabled !== 'boolean') add('warn', key, `${where}enabled должен быть true или false; не применён.`);
  }
  // Исходные артефакты (верхнеуровневый artifacts): name и content или attachment.
  function checkSources(schema, add) {
    const list = schema.artifacts;
    if (list == null) return [];
    if (!Array.isArray(list)) { add('error', null, 'artifacts верхнего уровня должен быть списком исходных артефактов { name, content | attachment }.'); return []; }
    const names = [];
    list.forEach((a, i) => {
      if (!isObj(a)) { add('error', null, `artifacts[${i}]: ожидается объект { "name", "content" | "attachment" }.`); return; }
      if (!own(a.name)) { add('error', null, `artifacts[${i}]: нет name.`); return; }
      names.push(a.name.trim());
      if (!own(a.content) && !own(a.attachment)) add('warn', null, `Артефакт «${a.name}» не передан: нет ни content (текст), ни attachment (имя файла, приложенного к ответу).`);
      if (own(a.attachment) && !/\.[A-Za-z0-9]{1,8}$/.test(a.attachment.trim())) add('warn', null, `attachment «${a.attachment}»: нужно точное имя файла с расширением.`);
    });
    return names;
  }

  // ---------- Проверка ----------
  // Возвращает { schema, flat, issues, comment }; schema = null, если схема не применяется; comment — текст вне JSON.
  function validate(text) {
    const issues = [];
    const add = (level, step, msg) => issues.push({ level, step, msg });
    const ctx = { comment: '' };
    const fail = () => ({ schema: null, flat: [], issues, comment: ctx.comment });
    const value = readJson(String(text == null ? '' : text).replace(/\r\n?/g, '\n'), add, ctx);
    if (value == null) return fail();
    const schema = rootOf(value, add);
    if (!schema) return fail();
    Object.keys(schema).filter((k) => !['task', 'version', 'description', 'artifacts', 'steps', 'defaults', 'run'].includes(k)).forEach((k) => add('warn', null, `Неизвестное поле схемы «${k}».`));
    const sourceNames = checkSources(schema, add);
    if ('version' in schema && !(Number.isInteger(schema.version) && schema.version >= 1)) add('warn', null, 'version должен быть целым числом от 1 — показано v1.');
    if ('description' in schema && typeof schema.description !== 'string') add('warn', null, 'description должен быть строкой — описание не показано.');
    if (!own(schema.task)) add('warn', null, 'Нет task — фразы задачи.');
    else if (STUB.test(schema.task)) add('warn', null, `Заглушка вместо текста в поле task: «${cut(schema.task, 30)}» — модель сократила ответ.`);
    if (!Array.isArray(schema.steps) || !schema.steps.length) { add('error', null, 'steps должен быть непустым списком этапов.'); return fail(); }
    checkRoot(schema, add);
    fixSteps(schema.steps, 'steps', add);

    const flat = schema.steps.map((step, i) => {
      const obj = isObj(step) ? step : {};
      return { step: obj, key: own(obj.id) ? obj.id : `steps[${i}]`, pos: i, raw: step };
    });
    const byId = new Map();
    // Артефакт без описания — мягкое замечание; одно и то же имя предупреждается один раз, если ни один этап не дал описания.
    const described = new Set();
    flat.forEach((e) => listOf(e.step.artifacts).forEach((a) => { if (own(artDesc(a))) described.add(artName(a)); }));
    const warnedArt = new Set();
    flat.forEach((e) => {
      const st = e.step;
      if (e.raw !== st) {
        add('error', e.key, typeof e.raw === 'string' && STUB.test(e.raw) ? `Заглушка «${cut(e.raw, 20)}» вместо этапа — модель сократила ответ; попросите полный список этапов.` : 'Этап должен быть объектом.');
        return;
      }
      if (!own(st.id)) add('error', e.key, 'Нет id.');
      else if (byId.has(st.id)) add('error', e.key, `id «${st.id}» повторяется.`);
      else byId.set(st.id, e);
      if (has(REMOVED_BLOCKS, st.block)) add('error', e.key, `Вид этапа «${st.block}» не поддерживается. ${REMOVED_BLOCKS[st.block]}.`);
      else if (!FIELDS[st.block]) add('error', e.key, st.block ? `Неизвестный блок «${st.block}».` : 'Нет block.');
      if (!own(st.title)) add('error', e.key, 'Нет title.');
      if (!own(st.why)) add('error', e.key, 'Нет why — зачем этот этап.');
      Object.keys(st).forEach((k) => {
        if (k === 'optional_inputs') add('warn', e.key, 'Поле «optional_inputs» не поддерживается и не применяется: пропускаемых этапов нет, все входы обязательны.');
        else if (k === 'order') add('warn', e.key, 'Поле «order» не поддерживается и не применяется: все модели раунда отвечают независимо; эстафета — раунды по одной модели подряд.');
        else if (has(REMOVED_FIELDS, k)) add('warn', e.key, `Поле «${k}» не поддерживается и не применяется. ${REMOVED_FIELDS[k]}.`);
        else if (k === 'body') add('error', e.key, 'Поле «body» не поддерживается: вложенных этапов нет.');
        else if (FIELDS[st.block] && !COMMON.includes(k) && !FIELDS[st.block].includes(k)) add('warn', e.key, `Неизвестное поле «${k}» для блока ${st.block}.`);
      });
      Object.entries(ENUMS).forEach(([k, values]) => {
        if (st[k] != null && FIELDS[st.block]?.includes(k) && !values.includes(st[k])) add('warn', e.key, `${k}: «${st[k]}» — ожидается ${values.join(' | ')}.`);
      });
      ['inputs', 'artifacts'].forEach((k) => { if (st[k] != null && !Array.isArray(st[k])) add('error', e.key, `${k} должен быть списком.`); });
      listOf(st.artifacts).forEach((a, i) => {
        if (typeof a !== 'string' && !isObj(a)) { add('error', e.key, `artifacts[${i}]: ожидается имя или объект { "name", "description" }.`); return; }
        const name = artName(a);
        if (!own(name)) { add('error', e.key, `artifacts[${i}]: нет name.`); return; }
        if (!described.has(name) && !warnedArt.has(name)) { warnedArt.add(name); add('warn', e.key, `У артефакта «${name}» нет описания.`); }
        if (a.document != null) {
          if (st.block !== 'round') add('warn', e.key, 'Признак document у артефакта только в раунде из одной модели.');
          else if (!['read', 'form'].includes(a.document)) add('warn', e.key, `document: «${a.document}» — ожидается read | form.`);
        }
      });
      if (st.block === 'round' && listOf(st.artifacts).filter((a) => isObj(a) && a.document != null).length > 1) add('warn', e.key, 'В раунде не больше одного артефакта-документа.');
      if (st.block === 'round' && (!Array.isArray(st.models) || !st.models.length)) add('error', e.key, 'У раунда нет models.');
      if (st.block === 'round' && Array.isArray(st.models)) st.models.forEach((m, i) => {
        if (!own(m?.name)) add('error', e.key, `models[${i}]: нет name.`);
        if (!isObj(m)) return;
        Object.keys(m).filter((k) => !MODEL_KEYS.includes(k)).forEach((k) => add('warn', e.key, `models[${i}].${k}: неизвестное поле модели; допустимы ${MODEL_KEYS.join(', ')}.`));
        checkOwnFields(m, `models[${i}].`, e.key, add);
      });
    });
    // Ссылки: только вверх — inputs; «in.Имя» — исходный артефакт.
    flat.forEach((e) => {
      const st = e.step;
      const refs = [];
      if (Array.isArray(st.inputs)) st.inputs.forEach((r) => refs.push(['inputs', r, 'up']));
      refs.forEach(([field, ref]) => {
        if (!own(ref)) { add('error', e.key, `${field}: пустая ссылка.`); return; }
        if (/^in\./.test(ref)) {
          const name = String(ref).slice(3);
          if (!sourceNames.includes(name)) add('error', e.key, `${field}: нет исходного артефакта «${name}» в artifacts верхнего уровня.`);
          return;
        }
        const target = byId.get(refId(ref));
        if (!target) { add('error', e.key, `${field}: этапа «${refId(ref)}» нет.`); return; }
        if (target.pos >= e.pos) add('error', e.key, `${field}: «${ref}» — ссылка ${target.pos === e.pos ? 'на себя' : 'вниз'}; можно только на этапы выше.`);
        const dot = String(ref).indexOf('.');
        if (dot > 0) {
          const name = String(ref).slice(dot + 1);
          if (!listOf(target.step.artifacts).map(artName).includes(name)) add('error', e.key, `${field}: у ${refId(ref)} нет артефакта «${name}» в artifacts.`);
        }
      });
    });
    // Предупреждения (не ошибки): ответ User должен читать этап ниже; раунд из нескольких моделей не даёт артефакта
    // и личного задания без общего; документ для User — из раунда из одной модели с артефактом-документом.
    const enabledOf = (s) => (Array.isArray(s.models) ? s.models.filter((m) => m?.enabled !== false) : []);
    flat.forEach((e) => {
      const st = e.step;
      if (st.block === 'owner' && own(st.id) && flat.some((x) => x.pos > e.pos)) {
        const read = flat.some((x) => x.pos > e.pos && listOf(x.step.inputs).some((r) => own(r) && refId(r) === st.id));
        if (!read) add('warn', e.key, `Ответ User «${st.id}» не читает ни один этап ниже: добавьте «${st.id}» во inputs этапа, который должен использовать ответ (этот этап исправляет артефакт по правкам User, а не приклеивает их отдельным разделом).`);
      }
      if (st.block === 'round' && listOf(st.artifacts).length && enabledOf(st).length > 1) {
        add('warn', e.key, `Артефакт объявлен в раунде из нескольких моделей: у каждой модели своя линия артефакта, ссылка «${st.id}.Имя» неоднозначна. Объявите артефакт в этапе из одной модели: общий документ — раунд из нескольких моделей без артефакта, затем этап «свести» из одной модели.`);
      }
      if (st.block === 'round' && own(st.task) && Array.isArray(st.models)) {
        const personal = st.models.map((m, i) => (own(m?.task) ? i : -1)).filter((i) => i >= 0);
        if (personal.length) add('warn', e.key, `models[${personal.join(', ')}].task заменяет общее task этапа для этих моделей (общее задание им не отправляется): повторите общие требования в личных заданиях или уберите личные.`);
      }
      if (st.block === 'owner' && st.document != null) {
        const src = byId.get(st.document);
        let problem = null;
        if (!src || src.pos >= e.pos) problem = `этапа «${st.document}» выше нет.`;
        else if (src.step.block !== 'round') problem = 'источник — раунд.';
        else if (enabledOf(src.step).length !== 1) problem = 'документ для User даёт раунд из одной модели.';
        else if (!listOf(src.step.artifacts).some((a) => isObj(a) && (a.document === 'read' || a.document === 'form'))) problem = `у раунда «${st.document}» нет артефакта с признаком document (read или form).`;
        if (problem) add('warn', e.key, `document: ${problem}`);
      }
    });
    // Повтор документа во входах: все включённые модели этапа уже получили ссылку в этом же чате — вход лишний.
    // Модель m имеет X с этапа K, если X — вход K для m (и без chat: new после K до этапа) или m — единственный автор X.
    flat.forEach((e) => {
      const st = e.step;
      if (st.block !== 'round') return;
      const ms = enabledOf(st);
      if (!ms.length) return;
      // Модели сравниваются по имени: у каждого этапа свои объекты моделей.
      const has = (step, name) => enabledOf(step).some((y) => y?.name === name);
      const earliest = (X, name) => {
        const fresh = (kPos) => !flat.some((x) => x.pos > kPos && x.pos <= e.pos && x.step.chat === 'new' && has(x.step, name));
        const cands = flat.filter((x) => x.pos < e.pos && has(x.step, name) && listOf(x.step.inputs).includes(X));
        if (!/^in\./.test(X)) {
          const p = byId.get(refId(X));
          if (p && p.pos < e.pos && p.step.block === 'round' && enabledOf(p.step).length === 1 && has(p.step, name)) cands.push(p);
        }
        return cands.filter((x) => fresh(x.pos)).sort((a, b) => a.pos - b.pos)[0] || null;
      };
      [...new Set(listOf(st.inputs).filter(own))].forEach((X) => {
        const firsts = ms.map((m) => earliest(X, m?.name));
        if (firsts.some((k) => !k)) return;
        add('warn', e.key, `Этап ${st.id}: все модели уже получали «${X}» (этап ${firsts[0].step.id}, тот же чат). Уберите вход и сошлитесь на документ по названию в задании.`);
      });
    });
    flat.forEach((e) => {
      const st = e.step;
      [...(Array.isArray(st.models) ? st.models.map((m) => m?.name) : []), st.model].filter(own).forEach((n) => {
        if (!MODEL_NAMES.includes(n)) add('warn', e.key, `Неизвестное имя модели «${n}»; допустимы: ${MODEL_NAMES.join(', ')}.`);
      });
    });
    return { schema, flat, issues, comment: ctx.comment };
  }

  // ---------- Состояние стенда ----------
  const DATA_KEYS = ['models', 'defaults', 'run', 'rounds', 'selectedModel'];
  const stand = { active: false, layout: [], issues: [], flat: [], schema: null, snapshot: null, name: null, current: null, text: '', comment: '' };

  // Дисциплина и свои поля модели/синтеза схемы → поля ProtoState.
  function disciplineOf(d) {
    const out = S().emptyDiscipline();
    if (!isObj(d)) return out;
    DISC_KEYS.slice(0, 4).forEach((k) => { if (own(d[k])) out[k] = d[k].trim(); });
    out.lines = listOf(d.lines).filter(own).map((x) => x.trim());
    return out;
  }
  const ownFields = (o) => ({ maxWords: wordsOf(o.maxWords), discipline: disciplineOf(o.discipline) });

  // Схема → ProtoState: раунды в порядке списка (синтез — раунд из одной модели); layout — колонки холста.
  function applySchema(schema, flat, issues) {
    const state = S();
    if (!stand.snapshot) {
      stand.snapshot = JSON.parse(JSON.stringify(DATA_KEYS.reduce((o, k) => ({ ...o, [k]: state[k] }), {})));
      stand.name = $('currentPipelineName')?.textContent || 'Default';
    }
    const steps = schema.steps.filter((st) => st && typeof st === 'object');
    const names = new Set(stand.snapshot.models);
    steps.forEach((st) => { listOf(st.models).forEach((m) => own(m?.name) && names.add(m.name)); });
    state.models = [...names];
    // defaults / run схемы поверх значений, бывших до первого «Применить».
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const snapD = clone(stand.snapshot.defaults || {});
    const d = isObj(schema.defaults) ? schema.defaults : {};
    const notes = isObj(d.modelNotes) ? Object.fromEntries(Object.entries(d.modelNotes).filter(([, v]) => own(v)).map(([n, v]) => [n, v.trim()])) : {};
    state.defaults = { ...snapD,
      roundTask: own(d.roundTask) ? d.roundTask.trim() : snapD.roundTask || '',
      discipline: isObj(d.discipline) ? disciplineOf(d.discipline) : snapD.discipline || state.emptyDiscipline(),
      modelNotes: { ...(snapD.modelNotes || {}), ...notes }, roundPrompts: snapD.roundPrompts || {} };
    const r = isObj(schema.run) ? schema.run : {};
    state.run = { ...clone(stand.snapshot.run || {}), ...(['auto', 'manual'].includes(r.policy) ? { policy: r.policy } : {}), ...(wordsOf(r.maxWords) ? { maxWords: wordsOf(r.maxWords) } : {}) };
    state.rounds = [];
    // Исходные артефакты (верхнеуровневый artifacts) — не этапы: лежат в зоне над колонкой In. Все этапы схемы — колонки потока.
    const flow = steps;
    stand.layout = flow.map((st, i) => {
      const col = { step: st, key: flat.find((e) => e.raw === st)?.key || st.id };
      if (st.block === 'round') {
        const index = state.rounds.length;
        const inputs = listOf(st.inputs);
        state.rounds.push({
          ref: own(st.id) ? st.id : `r${index + 1}`,
          input: inputs.length ? (inputs.length > 1 ? 'all' : 'previous') : (index === 0 ? '' : 'none'),
          task: own(st.task) ? st.task : '', role: 'None',
          models: listOf(st.models).filter((m) => m && typeof m === 'object').map((m) => {
            const id = roleIdOf(m.role);
            const roleLine = own(m.role) && !id ? `Роль: ${m.role.trim()}.` : '';
            return { name: String(m.name || '?'), enabled: m.enabled !== false, role: id || 'None', schemaRole: own(m.role) ? m.role.trim() : '', schemaTask: own(m.task) ? m.task.trim() : '',
              task: [roleLine, own(m.task) ? m.task.trim() : ''].filter(Boolean).join('\n\n'), ...ownFields(m) };
          }),
          artifacts: listOf(st.artifacts).map((a, k) => ({ id: `${st.id}-a${k + 1}`, title: artName(a), version: 1 }))
        });
        col.round = index;
      }
      return col;
    });
    // Исходные артефакты крепятся к In: от каждого стрелка к этапу, который берёт его через «in.Имя».
    stand.inDocs = listOf(schema.artifacts).filter((a) => isObj(a) && own(a.name)).map((a) => ({ id: a.name.trim(), title: a.name.trim(), src: a }));
    stand.schema = schema;
    stand.flat = flat;
    stand.issues = issues;
    stand.active = true;
    const name = $('currentPipelineName');
    if (name) { name.textContent = `v${Number.isInteger(schema.version) && schema.version >= 1 ? schema.version : 1}.${own(schema.task) ? cut(schema.task, 60) : 'Схема'}`; name.title = schema.task || ''; }
    render();
  }

  function reset() {
    const state = S();
    if (stand.snapshot) DATA_KEYS.forEach((k) => { state[k] = stand.snapshot[k]; });
    const name = $('currentPipelineName');
    if (name && stand.name != null) { name.textContent = stand.name; name.title = ''; }
    const entry = $('entryPoint');
    if (entry) entry.title = '';
    Object.assign(stand, { active: false, layout: [], issues: [], flat: [], schema: null, snapshot: null, name: null, current: null, comment: '' });
    canvas().render?.();
    drawIssues();
    catalog.activeId = null;
    catalog.loadedId = null;
    drawCatalog();
  }

  // ---------- Холст ----------
  const issuesOf = (key) => stand.issues.filter((it) => it.step === key);
  const bang = (key) => {
    const list = issuesOf(key);
    if (!list.length) return '';
    const err = list.some((it) => it.level === 'error');
    return `<span class="proto-stand-bang${err ? '' : ' is-warn'}"${tipAttrs(err ? 'Ошибка схемы' : 'Предупреждение схемы', list.map((it) => it.msg).join('\n'))}>!</span>`;
  };
  const inputsText = (st) => {
    const req = listOf(st.inputs).filter(own);
    return req.length ? `<div class="proto-stand-line">вход: ${esc(req.join(', '))}</div>` : '';
  };
  // Артефакты этапа — в зоне над блоками моделей, под бейджем. Версия: сколько этапов выше (включая этот) выдали артефакт с тем же именем.
  const artifactVersion = (k, name) => stand.layout.slice(0, k + 1).filter((c) => listOf(c.step.artifacts).map(artName).includes(name)).length;
  // Описание артефакта: у первого этапа схемы, который его задал (имя может повторяться в нескольких этапах).
  const artifactDesc = (name) => {
    for (const c of stand.layout) { const a = listOf(c.step.artifacts).find((x) => artName(x) === name && own(artDesc(x))); if (a) return artDesc(a); }
    return '';
  };
  // Вид исходного артефакта: текст в схеме или файл, приложенный к ответу.
  const docKind = (d) => (own(d.src?.content) ? 'текст' : own(d.src?.attachment) ? 'файл' : 'не передан');
  // Исходные артефакты — в зоне над In (k = -1); у колонок этапов исходных артефактов нет.
  const docChips = (k) => (k === -1 ? (stand.inDocs || []) : []).map((d) => {
    const label = docKind(d);
    return `<span class="proto-art proto-art-doc" data-art="doc|${esc(d.id)}"${tipAttrs(`${d.title} · исходный артефакт (${label})`, artDesc(d.src))}><span class="proto-art-title">${esc(d.title)}</span><span class="proto-art-version">${esc(label)}</span></span>`;
  }).join('');
  const artifactZone = (k, st) => `<div class="proto-art-zone">${listOf(st.artifacts).map(artName).map((name) => {
    const version = `v${artifactVersion(k, name)}`;
    return `<span class="proto-art" data-art="${k}|${esc(name)}"${tipAttrs(`${name} ${version}`, artifactDesc(name))}><span class="proto-art-title">${esc(name)}</span><span class="proto-art-version">${esc(version)}</span></span>`;
  }).join('')}${docChips(k)}</div>`;
  function openArtifact(k, name) {
    const col = stand.layout[k];
    if (!col) return;
    stand.current = null;
    const modal = infoModal();
    const users = artifactLinks().filter((l) => !l.doc && l.from === k && l.name === name).map((l) => stand.layout[l.to].step);
    modal.querySelector('.modal-content').innerHTML = `
      <header class="custom-card-top custom-defaults-top">
        <h3 class="custom-card-model"><i class="ti ti-file-text" aria-hidden="true"></i>${esc(name)}<span class="custom-card-where">артефакт v${artifactVersion(k, name)} · ${esc(col.step.id || '')}</span></h3>
        <button type="button" class="modal-button" data-stand-close>Закрыть</button>
      </header>
      <div class="custom-card-body">
        <div class="proto-stand-rows">
          <div class="proto-stand-row"><span>создаёт</span><div>${esc(col.step.id || '')} · ${esc(col.step.title || '')}</div></div>
          <div class="proto-stand-row"><span>берут</span><div>${users.length ? users.map((u) => `${esc(u.id || '')} · ${esc(u.title || '')}`).join('<br>') : 'никто'}</div></div>
        </div>
        <div class="custom-card-marks"><strong>Описание</strong>
          <div class="custom-card-note">${esc(artifactDesc(name) || NO_DESC)}</div>
        </div>
      </div>`;
    show(modal);
  }
  // Стрелки: от артефакта в колонке производителя к бейджу этапа, который берёт "<id>.<имя>" во входе.
  const artifactLinks = () => {
    const links = [];
    stand.layout.forEach((col, c) => listOf(col.step.inputs).forEach((ref) => {
      const id = refId(ref);
      const name = String(ref).slice(id.length + 1);
      if (!name) return;
      if (id === 'in') {
        if ((stand.inDocs || []).some((d) => d.id === name) && !links.some((l) => l.from === -1 && l.to === c && l.name === name)) links.push({ from: -1, to: c, name, doc: true });
        return;
      }
      const p = stand.layout.findIndex((x, k) => k < c && x.step.id === id && listOf(x.step.artifacts).map(artName).includes(name));
      if (p >= 0 && !links.some((l) => l.from === p && l.to === c && l.name === name)) links.push({ from: p, to: c, name });
    }));
    return links;
  };
  function openSource(id) {
    const st = (stand.inDocs || []).find((x) => x.id === id);
    if (!st) return;
    stand.current = null;
    const modal = infoModal();
    const users = stand.layout.filter((c) => listOf(c.step.inputs).some((r) => r === `in.${id}`)).map((c) => c.step);
    modal.querySelector('.modal-content').innerHTML = `
      <header class="custom-card-top custom-defaults-top">
        <h3 class="custom-card-model"><i class="ti ti-file-text" aria-hidden="true"></i>${esc(st.title)}<span class="custom-card-where">исходный артефакт (${esc(docKind(st))})</span></h3>
        <button type="button" class="modal-button" data-stand-close>Закрыть</button>
      </header>
      <div class="custom-card-body">
        <div class="proto-stand-rows">
          <div class="proto-stand-row"><span>источник</span><div>${own(st.src.content) ? 'текст в схеме' : esc(st.src.attachment || 'не передан')}</div></div>
          <div class="proto-stand-row"><span>берут</span><div>${users.length ? users.map((u) => `${esc(u.id || '')} · ${esc(u.title || '')}`).join('<br>') : 'никто'}</div></div>
        </div>
        <div class="custom-card-marks"><strong>Описание</strong>
          <div class="custom-card-note" style="white-space:pre-wrap">${esc(artDesc(st.src) || NO_DESC)}</div>
        </div>
      </div>`;
    show(modal);
  }
  // Описание модели: роль и задание модели; нет их — задание раунда.
  const modelDesc = (model, round) => {
    const own2 = [model.schemaRole ? `Роль: ${model.schemaRole}` : '', model.schemaTask].filter(Boolean).join('\n');
    return own2 || (round && own(round.task) ? `Задание раунда: ${round.task.trim()}` : '');
  };
  const modelBlock = (model, index, round) => {
    const on = model.enabled !== false;
    const options = ROLE_OPTIONS.map(([value, label]) => {
      const text = value === 'None' && model.schemaRole && !roleIdOf(model.schemaRole) ? model.schemaRole : label;
      return `<option value="${esc(value)}"${(model.role || 'None') === value ? ' selected' : ''}>${esc(text)}</option>`;
    }).join('');
    return `<div class="model-block ${on ? 'active' : 'inactive'} with-role" data-index="${index}" data-model="${esc(model.name)}"${tipAttrs(model.name, modelDesc(model, round))}>
        <div class="model-header">
          <span class="status-indicator" data-llm-name="${esc(model.name)}"></span>
          <input type="checkbox" class="model-checkbox model-input-checkbox"${on ? ' checked' : ''} aria-label="Input" title="Input">
          <span class="model-name">${esc(model.name)}</span>        </div>
        <select class="role-selector judge-prompt-selector"${on ? '' : ' disabled'}>${options}</select>
      </div>`;
  };
  function columnHtml(col, k, prevId) {
    const st = col.step;
    const key = col.key;
    const stack = `stand-stack-${k}`;
    const head = (badge, extra = '', tip = '') => `<div class="stage-label"${tip}><span class="round-badge${extra}">${badge}</span></div>`;
    const tail = inputsText(st, prevId);
    if (col.round != null) {
      const round = S().rounds[col.round];
      const tip = tipAttrs(`R${col.round + 1} · ${st.title || st.id || ''}`, st.why);
      return `<div class="stage-column" data-round-index="${col.round}" data-stand-key="${esc(key)}"${tip}>
          ${head(`R${col.round + 1}`, '', tip)}
          ${artifactZone(k, st)}
          <div class="model-stack" id="${stack}">${round.models.map((m, i) => modelBlock(m, i, round)).join('')}</div>
          <div class="proto-stand-meta">${bang(key)}<span class="proto-stand-line"${tip}><b>${esc(st.id || '')}</b> ${esc(cut(st.title, 40))}</span>${tail}</div>
        </div>`;
    }
    const [label, icon] = KIND[st.block] || [String(st.block || '?'), 'ti-help'];
    const human = HUMAN_BLOCKS.includes(st.block);
    const app = APP_BLOCKS.includes(st.block) ? '<div class="proto-stand-line proto-stand-app">приложение</div>' : '';
    const extra = [own(st.ask) ? `Вопрос: ${st.ask.trim()}` : '', own(st.file) ? `Файл: ${st.file.trim()}${own(st.mode) ? ` (${st.mode.trim()})` : ''}` : ''].filter(Boolean);
    const tip = tipAttrs(`${label} · ${st.title || st.id || ''}`, [own(st.why) ? st.why.trim() : '', ...extra].join('\n'));
    return `<div class="stage-column" data-stand-key="${esc(key)}"${tip}>
        ${head(esc(label), ` proto-stand-kind${human ? ' proto-human-kind' : ''}`, tip)}
        ${artifactZone(k, st)}
        <div class="model-stack" id="${stack}">
          <div class="model-block inactive proto-stand-card${human ? ' proto-human' : ''}" data-stand-key="${esc(key)}"${tip}>
            <div class="model-header"><i class="ti ${icon} proto-stand-icon" aria-hidden="true"></i><span class="model-name">${human ? 'User' : esc(st.title || '—')}</span>${bang(key)}</div>
            ${app}<div class="proto-stand-line"${tip}>${human ? `<b>${esc(st.id || '')}</b> ${esc(cut(st.title, 40))}` : `<b>${esc(st.id || '')}</b>`} ${esc(cut(st.why, 70))}</div>
          </div>
        </div>
        <div class="proto-stand-meta">${inputsText(st, prevId)}</div>
      </div>`;
  }

  // Линия к этапу активна, если он берёт вход у соседа слева (inputs); иначе — серая.
  const linksTo = (st, id) => !!id && listOf(st.inputs).some((r) => own(r) && refId(r) === id);

  // Верхний отступ под полосу стрелок: пусто, когда стрелки выключены, — схема поднимается наверх.
  const arrowsPadding = () => (stand.arrows !== false && artifactLinks().length ? `${12 + artifactLinks().length * 6}px` : '');
  function render() {
    const root = $('pipelineFlow');
    if (!root) return;
    const cols = stand.layout;
    const inDesc = (stand.inDocs || []).map((d) => `${d.title} (${docKind(d)}) — ${artDesc(d.src) || NO_DESC}`).join('\n');
    const inTip = tipAttrs('In · исходные артефакты', inDesc || (own(stand.schema?.description) ? cut(stand.schema.description, 400) : ''));
    let html = `<div class="stage-column entry-column"${inTip}>
        <button type="button" class="proto-arrows-toggle" id="protoArrowsToggle" aria-pressed="${stand.arrows !== false}" aria-label="Arrows" title="Стрелки артефактов"><svg viewBox="0 0 16 14" aria-hidden="true"><path d="M2 3h9M8.5 0.5 11 3 8.5 5.5"/><path d="M2 7h9M8.5 4.5 11 7 8.5 9.5"/><path d="M2 11h9M8.5 8.5 11 11 8.5 13.5"/></svg></button>
        <div class="stage-label"${inTip}><span class="entry-badge">In</span></div>
        <div class="proto-art-zone">${docChips(-1)}</div>
        <div class="entry-wrapper" id="entryWrapper"><div class="entry-point" id="entryPoint"${tipAttrs('▶ Общие значения', own(stand.schema?.description) ? cut(stand.schema.description, 400) : '')} style="cursor:pointer">▶</div></div>
      </div>
      <div class="connector-group"><svg class="connector-svg" id="svg-in-models"></svg></div>`;
    cols.forEach((col, k) => {
      if (k > 0) html += `<div class="connector-group"><svg class="connector-svg" id="stand-svg-${k}"></svg></div>`;
      html += columnHtml(col, k, k > 0 ? cols[k - 1].step.id : '');
    });
    const per = Math.max(0, (stand.inDocs || []).length, ...cols.map((col) => listOf(col.step.artifacts).length));
    root.style.setProperty('--proto-art-zone', per ? '42px' : '0px');
    root.style.paddingTop = arrowsPadding();
    root.style.paddingLeft = '36px';
    root.innerHTML = html;
    // Шапка (число раундов, предел слов, Auto) — как у холста, из ProtoState.
    canvas().syncChrome?.();
    ['debate-round-minus-btn', 'pipeline-add-round-btn'].forEach((id) => { const b = $(id); if (b) b.disabled = true; });
    draw();
    requestAnimationFrame(draw);
  }

  function draw() {
    const panel = $('pipeline-panel');
    if (!panel || !stand.active) return;
    const cols = stand.layout;
    const blockH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pipeline-block-height')) || 64;
    let max = blockH;
    panel.querySelectorAll('#pipelineFlow .model-stack').forEach((stack) => {
      const last = stack.lastElementChild;
      if (last) max = Math.max(max, last.getBoundingClientRect().bottom - stack.getBoundingClientRect().top);
    });
    // Все стопки одной высоты, блоки под ними (вход, название) стоят на одной линии по верхнему краю.
    $('pipelineFlow')?.style.setProperty('--proto-stack-h', `${max}px`);
    panel.querySelectorAll('#pipelineFlow .connector-svg').forEach((svg) => { svg.style.height = `${max}px`; svg.setAttribute('height', `${max}`); });
    const entry = $('entryWrapper');
    if (entry) entry.style.height = `${max}px`;
    const mode = (col, side) => (col.round != null ? side : 'all');
    if (cols.length) canvas().drawInputSplitConnector?.('svg-in-models', 'stand-stack-0', 'active', mode(cols[0], 'input'));
    for (let k = 1; k < cols.length; k++) {
      const color = linksTo(cols[k].step, cols[k - 1].step.id) ? 'brain-flow' : 'inactive';
      canvas().drawMergeSplitConnector?.(`stand-svg-${k}`, `stand-stack-${k - 1}`, `stand-stack-${k}`, color, { sourceMode: mode(cols[k - 1], 'input'), targetMode: mode(cols[k], 'input') });
    }
      drawArtifactLinks();
  }
  // Линии артефактов рисуются поверх потока: вверх в полосу над бейджами, вдоль неё и вниз на бейдж потребителя.
  function drawArtifactLinks() {
    const root = $('pipelineFlow');
    if (!root) return;
    root.querySelector(':scope > .proto-art-svg')?.remove();
    const links = artifactLinks();
    if (!links.length || stand.arrows === false) return;
    const columns = [...root.querySelectorAll(':scope > .stage-column:not(.entry-column)')];
    const base = root.getBoundingClientRect();
    const rel = (el) => { const r = el.getBoundingClientRect(); return { l: r.left - base.left, r: r.right - base.left, t: r.top - base.top, b: r.bottom - base.top, cx: (r.left + r.right) / 2 - base.left, cy: (r.top + r.bottom) / 2 - base.top }; };
    const slots = new Map();
    let html = '';
    links.forEach((link, i) => {
      const col = link.from === -1 ? root.querySelector(':scope > .entry-column') : columns[link.from];
      const to = columns[link.to]?.querySelector('.stage-label > span');
      const box = [...(col?.querySelectorAll('.proto-art') || [])].find((el) => el.dataset.art === (link.doc ? `doc|${link.name}` : `${link.from}|${link.name}`));
      if (!box || !to) return;
      const a = rel(box); const c = rel(col); const t = rel(to);
      const slot = slots.get(link.from) || 0; slots.set(link.from, slot + 1);
      const xv = c.r + 6 + slot * 4;
      const lane = 6 + i * 6;
      const path = `M ${a.cx} ${a.t} V ${a.t - 4} H ${xv} V ${lane} H ${t.cx} V ${t.t - 2}`;
      html += `<path d="${path}" class="proto-art-line"/><path d="M ${t.cx - 4} ${t.t - 7} L ${t.cx} ${t.t - 1} L ${t.cx + 4} ${t.t - 7}" class="proto-art-line"/>`;
    });
    root.insertAdjacentHTML('afterbegin', `<svg class="proto-art-svg" width="${root.scrollWidth}" height="${root.scrollHeight}" aria-hidden="true">${html}</svg>`);
  }

  // ---------- Окна ----------
  const indent = (text) => String(text).split('\n').map((line) => `  ${line}`).join('\n');
  const fmtDiscipline = (d) => (isObj(d) ? Object.entries(d).map(([k, v]) => (k === 'lines' && Array.isArray(v)
    ? `${DISC_LABELS.lines}:${v.length ? `\n${v.map((x) => `  • ${x}`).join('\n')}` : ' —'}`
    : `${DISC_LABELS[k] || k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)).join('\n') : String(d));
  const fmt = (key, value) => {
    if (value == null || value === '') return '—';
    if (key === 'models' && Array.isArray(value)) {
      return value.map((m) => (m && typeof m === 'object' ? [`${m.name || '?'}${own(m.role) ? ` (роль: ${m.role})` : ''}${own(m.task) ? ` — ${m.task}` : ''}`,
        ...Object.keys(m).filter((x) => !['name', 'role', 'task'].includes(x)).map((x) => indent(`${LABELS[x] || x}:${x === 'discipline' ? `\n${indent(fmt(x, m[x]))}` : ` ${fmt(x, m[x])}`}`))].join('\n') : String(m))).join('\n');
    }
    if (key === 'artifacts' && Array.isArray(value)) return value.map((a) => (artDesc(a) ? `${artName(a)} — ${artDesc(a)}` : artName(a))).join('; ');
    if (key === 'discipline') return fmtDiscipline(value);
    if (key === 'maxWords') return wordsOf(value) ? `${wordsOf(value)} слов` : String(value);
    if (key === 'modelNotes' && isObj(value)) return Object.entries(value).map(([n, v]) => `${n}: ${v}`).join('\n') || '—';
    if (key === 'run' && isObj(value)) {
      return Object.entries(value).map(([k, v]) => (k === 'policy' ? `запуск: ${v}${POLICY_TEXT[v] ? ` (${POLICY_TEXT[v]})` : ''}` : k === 'maxWords' ? `общий предел: ${fmt('maxWords', v)}` : `${k}: ${fmt(k, v)}`)).join('\n');
    }
    if (key === 'defaults' && isObj(value)) {
      const names = { roundTask: 'задание раундов', discipline: 'дисциплина', modelNotes: 'особенности моделей' };
      return Object.entries(value).map(([k, v]) => (isObj(v) ? `${names[k] || k}:\n${indent(fmt(k, v))}` : `${names[k] || k}: ${fmt(k, v)}`)).join('\n');
    }
    if (Array.isArray(value)) return value.map((v) => (v && typeof v === 'object' ? fmt('', v) : String(v))).join(', ');
    if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}: ${typeof v === 'object' ? fmt(k, v) : v}`).join(', ');
    return String(value);
  };
  // isRoot — раздел окна ▶: поля верхнего уровня схемы (task, defaults, run) и общие замечания.
  function schemaSection(st, isRoot) {
    const keys = isRoot ? ['task', 'artifacts', 'defaults', 'run'] : [...COMMON.filter((k) => k in st || ['block', 'title', 'why', 'inputs', 'artifacts'].includes(k)),
      ...Object.keys(st).filter((k) => !COMMON.includes(k))];
    const issues = isRoot ? issuesOf(null) : issuesOf(stand.flat.find((e) => e.raw === st)?.key);
    return `<div class="custom-card-marks proto-stand-schema"><strong>Из схемы</strong>
      ${issues.length ? `<div class="proto-stand-issues"><div class="proto-stand-summary">Стенд v${STAND_VERSION}</div>${issues.map((it) => `<div class="is-${it.level}">${it.level === 'error' ? 'Ошибка' : 'Замечание'}: ${esc(it.msg)}</div>`).join('')}</div>` : ''}
      <div class="proto-stand-rows">${keys.map((k) => `<div class="proto-stand-row"><span>${esc(isRoot && k === 'task' ? 'задача' : LABELS[k] || k)} <code>${esc(k)}</code></span><div>${esc(fmt(k, st[k]))}</div></div>`).join('')}</div>
    </div>`;
  }
  // Раздел «Из схемы» дописывается в окно cards.js и восстанавливается после его перерисовки.
  function ensureSection() {
    const cur = stand.current;
    if (!stand.active || !cur) return;
    const box = cur.where === 'stage'
      ? ($('pipeline-stage-dialog')?.open ? $('pipeline-stage-card') : null)
      : ($('pipeline-block-info-modal')?.classList.contains('is-visible') ? $('pipeline-block-info-modal').querySelector('.custom-card-body') : null);
    if (!box || box.querySelector(':scope > .proto-stand-schema')) return;
    box.insertAdjacentHTML('beforeend', schemaSection(cur.step, cur.root));
    if (cur.root) box.insertAdjacentHTML('afterbegin', descriptionBlock(cur.step.description));
  }
  // Описание схемы для пользователя: на работу не влияет. Свёрнуто до двух строк, по кнопке — на весь экран.
  const descriptionBlock = (text) => `<div class="proto-stand-desc" id="proto-stand-desc"><div class="proto-stand-desc-head"><strong>Description</strong><button type="button" class="proto-stand-desc-toggle" aria-expanded="false" aria-controls="proto-stand-desc-text" title="Развернуть на весь экран">⤢</button></div><div class="proto-stand-desc-text" id="proto-stand-desc-text">${own(text) ? esc(text) : '<em>Описание не задано: в схеме нет поля description.</em>'}</div></div>`;
  document.addEventListener('click', (event) => {
    const button = event.target.closest('.proto-stand-desc-toggle');
    if (!button) return;
    const box = button.closest('.proto-stand-desc');
    const full = box.classList.toggle('is-full');
    button.setAttribute('aria-expanded', String(full));
    button.textContent = full ? '✕' : '⤢';
    button.title = full ? 'Свернуть' : 'Развернуть на весь экран';
  });
  new MutationObserver(ensureSection).observe(document.body, { childList: true, subtree: true });

  function infoModal() {
    let modal = $('proto-stand-info');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal pipeline-block-info-modal custom-model-card';
      modal.id = 'proto-stand-info';
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.innerHTML = '<div class="modal-content"></div>';
      modal.addEventListener('click', (event) => { if (event.target === modal || event.target.closest('[data-stand-close]')) hide(modal); });
      document.body.appendChild(modal);
    }
    return modal;
  }
  // «Назначение» — первый раздел окна блока User: зачем он и что делает User.
  const purposeSection = (st) => {
    if (!HUMAN_BLOCKS.includes(st.block)) return '';
    return `<div class="custom-card-marks proto-stand-purpose"><strong>Назначение</strong>
      <div class="custom-card-note">${esc(own(st.why) ? st.why : 'не задано')}</div>
      <div class="custom-card-note"><b>Вопрос User:</b> ${esc(own(st.ask) ? st.ask : 'не задан')}</div>
    </div>`;
  };
  function openInfo(st) {
    stand.current = null;
    const modal = infoModal();
    const [label, icon] = KIND[st.block] || [String(st.block || '?'), 'ti-help'];
    modal.querySelector('.modal-content').innerHTML = `
      <header class="custom-card-top custom-defaults-top">
        <h3 class="custom-card-model"><i class="ti ${icon}" aria-hidden="true"></i>${HUMAN_BLOCKS.includes(st.block) ? 'User' : esc(st.title || st.id || '—')}<span class="custom-card-where">${esc(label)} · ${esc(st.id || '')}${HUMAN_BLOCKS.includes(st.block) && own(st.title) ? ` · ${esc(st.title)}` : ''}</span></h3>
        <button type="button" class="modal-button" data-stand-close>Закрыть</button>
      </header>
      <div class="custom-card-body">${purposeSection(st)}${schemaSection(st)}</div>`;
    show(modal);
  }
  const show = (modal) => { modal.style.display = 'flex'; modal.classList.add('is-visible'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open'); };
  const hide = (modal) => { modal.style.display = 'none'; modal.classList.remove('is-visible'); modal.setAttribute('aria-hidden', 'true'); if (!anyOpen()) document.body.classList.remove('modal-open'); };
  const anyOpen = () => ['pipeline-block-info-modal', 'proto-stand-info', 'proto-stand-modal'].some((id) => $(id)?.classList.contains('is-visible')) || !!$('pipeline-stage-dialog')?.open;

  const colOf = (key) => stand.layout.find((c) => c.key === key);
  const CONTROLS = 'input, select, button, option, summary';
  function bindFlow() {
    const flow = $('pipelineFlow');
    flow.addEventListener('transitionend', (event) => { if (event.target === flow && event.propertyName === 'padding-top' && stand.active) draw(); });
    flow.addEventListener('click', (event) => {
      if (!stand.active) return;
      const t = event.target;
      const arrows = t.closest('#protoArrowsToggle');
      if (arrows) {
        event.stopPropagation();
        stand.arrows = stand.arrows === false;
        arrows.setAttribute('aria-pressed', String(stand.arrows));
        // Верхний отступ под полосу стрелок плавно меняется (CSS transition); стрелки и связи перерисуются по его окончании.
        flow.querySelector(':scope > .proto-art-svg')?.remove();
        flow.style.paddingTop = arrowsPadding();
        return;
      }
      const art = t.closest('.proto-art');
      if (art) {
        event.stopPropagation();
        event.preventDefault();
        const [k, ...rest] = art.dataset.art.split('|');
        if (k === 'doc') openSource(rest.join('|')); else openArtifact(Number(k), rest.join('|'));
        return;
      }
      const badge = t.closest('.round-badge');
      if (badge) {
        event.stopPropagation();
        event.preventDefault();
        const col = colOf(badge.closest('.stage-column')?.dataset.standKey);
        if (col?.round != null) { stand.current = { step: col.step, where: 'stage' }; cards().openRound?.(col.round); }
        return;
      }
      if (t.closest('#entryPoint')) { event.stopPropagation(); stand.current = { step: stand.schema, where: 'card', root: true }; cards().openEntry?.(); }
    }, true);
    flow.addEventListener('dblclick', (event) => {
      if (!stand.active) return;
      const t = event.target;
      if (t.closest('select, input, button, option')) return;
      event.stopPropagation();
      if (t.closest('summary')) return;
      const column = t.closest('.stage-column[data-stand-key]');
      const col = colOf(column?.dataset.standKey);
      if (!col) return;
      event.preventDefault();
      if (col.round != null) {
        const block = t.closest('.model-block');
        const model = block && S().rounds[col.round]?.models?.[Number(block.dataset.index)];
        stand.current = { step: col.step, where: model ? 'card' : 'stage' };
        if (model) cards().openModel?.(col.round, model.name);
        else cards().openRound?.(col.round);
        return;
      }
      openInfo(col.step);
    }, true);
    // «Новый pipeline» — только на исходном холсте.
    $('pipeline-add-btn')?.addEventListener('click', () => { if (stand.active) reset(); }, true);
    root.addEventListener('resize', () => { if (stand.active) draw(); });
    flow.addEventListener('toggle', () => { if (stand.active) draw(); }, true);
  }

  // ---------- Окно ввода ----------
  function standModal() {
    let modal = $('proto-stand-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.className = 'modal pipeline-block-info-modal custom-model-card custom-defaults-card';
    modal.id = 'proto-stand-modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'proto-stand-title');
    modal.innerHTML = `<div class="modal-content">
      <header class="custom-card-top custom-defaults-top">
        <h3 class="custom-card-model" id="proto-stand-title">Стенд схемы<span class="custom-card-where">JSON { task, steps } · клавиша I · v${STAND_VERSION}</span></h3>
        <div class="proto-stand-actions">
          <button type="button" class="modal-button" id="proto-stand-clear" title="Очистить поле" aria-label="Очистить поле"><i class="ti ti-trash" aria-hidden="true"></i></button>
          <button type="button" class="modal-button" id="proto-stand-example">Загрузить пример</button>
          <button type="button" class="modal-button" id="proto-stand-reset">Сбросить</button>
          <button type="button" class="modal-button accent" id="proto-stand-apply">Применить</button>
          <button type="button" class="modal-button" id="proto-stand-close">Закрыть</button>
        </div>
      </header>
      <div class="custom-card-body">
        <div class="custom-card-field">
          <div class="custom-card-head"><label for="proto-stand-json">Схема этапов</label><span>Вставьте JSON, который предложила нейросеть, и нажмите «Применить».</span></div>
          <textarea id="proto-stand-json" spellcheck="false" placeholder='{ "task": "…", "steps": [ … ] }'></textarea>
        </div>
        <div class="proto-stand-issues" id="proto-stand-issues"></div>
        <div class="custom-card-note"><button type="button" id="proto-stand-example-defaults">Пример с defaults</button></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const area = modal.querySelector('#proto-stand-json');
    modal.addEventListener('click', (event) => { if (event.target === modal) hide(modal); });
    modal.querySelector('#proto-stand-close').addEventListener('click', () => hide(modal));
    modal.querySelector('#proto-stand-example').addEventListener('click', () => { area.value = JSON.stringify(EXAMPLES.basic, null, 2); area.focus(); });
    modal.querySelector('#proto-stand-example-defaults').addEventListener('click', () => { area.value = JSON.stringify(EXAMPLES.defaults, null, 2); area.focus(); });
    modal.querySelector('#proto-stand-clear').addEventListener('click', () => { area.value = ''; stand.text = ''; stand.comment = ''; drawIssues('Поле очищено.', []); area.focus(); });
    modal.querySelector('#proto-stand-reset').addEventListener('click', () => { area.value = ''; stand.text = ''; reset(); });
    modal.querySelector('#proto-stand-apply').addEventListener('click', () => {
      stand.text = area.value;
      const { schema, flat, issues, comment } = validate(area.value);
      stand.comment = comment;
      if (schema) { applySchema(schema, flat, issues); catalog.activeId = null; catalog.loadedId = null; drawCatalog(); }
      drawIssues(schema ? null : 'Схема не применена.', issues);
      if (schema && !issues.length) hide(modal);
    });
    return modal;
  }
  function drawIssues(note, list = stand.issues) {
    const box = $('proto-stand-issues');
    if (!box) return;
    const errors = list.filter((it) => it.level === 'error').length;
    const head = note || (stand.active ? (list.length ? `Ошибок: ${errors}, замечаний: ${list.length - errors}. Схема нарисована.` : 'Замечаний нет. Схема нарисована.') : '');
    box.innerHTML = `<div class="proto-stand-summary">${esc(`Стенд v${STAND_VERSION}${head ? ` · ${head}` : ''}`)}</div>${list.map((it) => `<div class="is-${it.level}">${it.step ? `<b>${esc(it.step)}</b>: ` : ''}${esc(it.msg)}</div>`).join('')}${stand.comment
      ? `<details class="proto-stand-comment"><summary>Комментарий модели</summary><div>${esc(stand.comment)}</div></details>` : ''}`;
  }
  function openStand() {
    const modal = standModal();
    const area = modal.querySelector('#proto-stand-json');
    if (!area.value && stand.text) area.value = stand.text;
    drawIssues();
    show(modal);
    area.focus();
  }

  // Слушаем на window в фазе перехвата: так клавиша доходит раньше обработчиков страницы и расширений браузера.
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      const info = $('proto-stand-info');
      if (info?.classList.contains('is-visible')) { hide(info); return; }
      const modal = $('proto-stand-modal');
      if (modal?.classList.contains('is-visible')) hide(modal);
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    if (!['i', 'I', 'ш', 'Ш'].includes(event.key) && event.code !== 'KeyI') return;
    const t = event.target;
    if (t && (t.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]') || t.isContentEditable)) return;
    if (anyOpen() || document.querySelector('dialog[open]')) return;
    event.preventDefault();
    event.stopPropagation();
    openStand();
  }, true);

  // Кнопка «i» в шапке панели (#pipeline-profile-btn) открывает стенд; клавиша I делает то же.
  const infoButton = document.getElementById('pipeline-profile-btn');
  if (infoButton) {
    infoButton.title = `Стенд JSON (кнопка «i» или клавиша I) · v${STAND_VERSION}`;
    infoButton.setAttribute('aria-label', infoButton.title);
    infoButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!anyOpen() && !document.querySelector('dialog[open]')) openStand();
    }, true);
  }

  // ---------- Каталог шаблонов ----------
  // Применённые схемы сохраняются шаблонами (Save) в один JSON-файл на компьютере (File System Access API);
  // handle файла — в IndexedDB, копия каталога — в localStorage. Список — пункты #pipelineItems под Default.
  const CATALOG_FORMAT = 'autoorchestr-stand-templates';
  const CACHE_KEY = 'protoStandTemplates';
  const FILE_TYPES = [{ description: 'JSON', accept: { 'application/json': ['.json'] } }];
  // Папка схем по умолчанию — Загрузки/Схемы: окно открывается в Загрузках, дальше браузер помнит последнюю папку для этого id.
  const PICKER = { id: 'basicSchemas', startIn: 'downloads' };
  const catalog = {
    templates: [], handle: null, fileName: '', loaded: false, status: 'none', // none | ready | prompt | unread
    activeId: null, loadedId: null, unsaved: new Set(), deleted: new Set()
  };
  const plural = (n, forms) => forms[n % 10 === 1 && n % 100 !== 11 ? 0 : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 1 : 2];
  const uid = () => (root.crypto?.randomUUID ? root.crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const pickSchema = (s) => JSON.parse(JSON.stringify(['task', 'version', 'description', 'artifacts', 'steps', 'defaults', 'run'].reduce((o, k) => (s[k] !== undefined ? { ...o, [k]: s[k] } : o), {})));
  const countSteps = (s) => (Array.isArray(s?.steps) ? s.steps.length : 0);
  const catalogDoc = () => ({ format: CATALOG_FORMAT, version: 1, stand: STAND_VERSION, templates: catalog.templates });
  const catalogText = () => JSON.stringify(catalogDoc(), null, 2);

  let toastTimer = 0;
  function toast(text) {
    let box = $('proto-stand-toast');
    if (!box) { box = document.createElement('div'); box.id = 'proto-stand-toast'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
    box.textContent = text;
    box.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => box.classList.remove('is-visible'), 2500);
  }

  // Содержимое файла → список шаблонов или null, если файл не похож на каталог.
  function parseCatalog(text) {
    let doc;
    try { doc = JSON.parse(text); } catch (error) { return null; }
    if (!isObj(doc) || doc.format !== CATALOG_FORMAT || !Array.isArray(doc.templates)) return null;
    return doc.templates.filter((t) => isObj(t) && isObj(t.schema) && Array.isArray(t.schema.steps)).map((t) => ({
      id: own(t.id) ? t.id : uid(),
      name: own(t.name) ? t.name : (own(t.schema.task) ? cut(t.schema.task, 48) : 'Схема'),
      savedAt: own(t.savedAt) ? t.savedAt : new Date().toISOString(),
      schema: t.schema,
      comment: own(t.comment) ? t.comment : ''
    }));
  }
  function saveCache() { try { localStorage.setItem(CACHE_KEY, catalogText()); } catch (error) { /* кэш недоступен */ } }
  function loadCache() {
    try { const list = parseCatalog(localStorage.getItem(CACHE_KEY) || ''); if (list) catalog.templates = list; } catch (error) { /* кэш недоступен */ }
  }

  // IndexedDB 'proto-stand' / 'kv': handle файла каталога под ключом 'catalogHandle'.
  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      let req;
      try { req = indexedDB.open('proto-stand', 1); } catch (error) { reject(error); return; }
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction('kv', mode);
          const r = fn(tx.objectStore('kv'));
          tx.oncomplete = () => { db.close(); resolve(r?.result); };
          tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
        } catch (error) { db.close(); reject(error); }
      };
    });
  }
  const idbGetHandle = () => idb('readonly', (s) => s.get('catalogHandle'));
  const idbSetHandle = (h) => idb('readwrite', (s) => s.put(h, 'catalogHandle')).catch((error) => console.warn('[stand] handle не сохранён', error));

  async function access(h, ask) {
    try {
      if (await h.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
      return ask ? (await h.requestPermission({ mode: 'readwrite' })) === 'granted' : false;
    } catch (error) { return false; }
  }
  const readHandle = async (h) => (await h.getFile()).text();
  async function writeHandle(h, text) { const w = await h.createWritable(); await w.write(text); await w.close(); }

  // Каталог из файла: шаблоны файла + несохранённые в файл шаблоны из памяти, без удалённых в этой сессии.
  async function readCatalogFile(h) {
    const list = parseCatalog(await readHandle(h));
    if (!list) throw new Error('format');
    const mem = catalog.templates.filter((t) => catalog.unsaved.has(t.id));
    catalog.templates = [...list.filter((t) => !catalog.deleted.has(t.id) && !mem.some((m) => m.id === t.id)), ...mem];
    catalog.loaded = true;
    catalog.status = 'ready';
    if (catalog.activeId && !catalog.templates.some((t) => t.id === catalog.activeId)) { catalog.activeId = null; catalog.loadedId = null; }
    saveCache();
  }

  // Восстановление handle при загрузке страницы (и в проверках — с подставленным handle).
  async function restore(h) {
    if (!h) { catalog.status = 'none'; drawCatalog(); return catalog.status; }
    catalog.handle = h;
    catalog.fileName = h.name || 'stand-templates.json';
    catalog.loaded = false;
    if (await access(h, false)) {
      try { await readCatalogFile(h); } catch (error) { catalog.status = 'unread'; }
    } else catalog.status = 'prompt';
    drawCatalog();
    return catalog.status;
  }

  // Запись всего каталога в файл. Вызывается из клика (жест): выбор файла и запрос прав допустимы.
  async function persist() {
    if (!catalog.handle) {
      if (typeof root.showSaveFilePicker !== 'function') return { ok: false, msg: 'Нет доступа к файлам: используйте Export' };
      let h;
      try { h = await root.showSaveFilePicker({ ...PICKER, suggestedName: 'stand-templates.json', types: FILE_TYPES }); } catch (error) {
        return { ok: false, msg: error?.name === 'AbortError' ? 'Файл не выбран: шаблон только в памяти' : `Файл не выбран (${error?.message || error}): шаблон только в памяти` };
      }
      Object.assign(catalog, { handle: h, fileName: h.name || 'stand-templates.json', loaded: true, status: 'ready' });
      idbSetHandle(h);
    } else {
      if (!(await access(catalog.handle, true))) { catalog.status = catalog.loaded ? catalog.status : 'prompt'; drawCatalog(); return { ok: false, msg: 'Нет доступа к файлу: шаблон только в памяти' }; }
      if (!catalog.loaded) {
        let text = '';
        try { text = await readHandle(catalog.handle); } catch (error) { /* файла нет — будет создан */ }
        if (text.trim()) {
          try { await readCatalogFile(catalog.handle); } catch (error) { catalog.status = 'unread'; drawCatalog(); return { ok: false, msg: `${catalog.fileName}: файл не похож на каталог шаблонов — шаблон только в памяти` }; }
        }
        Object.assign(catalog, { loaded: true, status: 'ready' });
      }
    }
    try { await writeHandle(catalog.handle, catalogText()); } catch (error) { return { ok: false, msg: `Не удалось записать ${catalog.fileName}: ${error?.message || error}` }; }
    catalog.unsaved.clear();
    catalog.deleted.clear();
    drawCatalog();
    return { ok: true, msg: `Каталог: ${catalog.fileName}` };
  }

  const uniqueName = (base, skipId) => {
    const taken = new Set(catalog.templates.filter((t) => t.id !== skipId).map((t) => t.name));
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
    return name;
  };
  async function saveTemplate() {
    if (!stand.active || !stand.schema) { toast('Сначала примените схему (кнопка i)'); return; }
    const now = new Date().toISOString();
    let tpl = catalog.loadedId ? catalog.templates.find((t) => t.id === catalog.loadedId) : null;
    if (tpl) Object.assign(tpl, { schema: pickSchema(stand.schema), savedAt: now, comment: stand.comment || '' });
    else {
      tpl = { id: uid(), name: uniqueName(own(stand.schema.task) ? cut(stand.schema.task, 48) : 'Схема'), savedAt: now, schema: pickSchema(stand.schema), comment: stand.comment || '' };
      catalog.templates.push(tpl);
    }
    catalog.unsaved.add(tpl.id);
    catalog.activeId = catalog.loadedId = tpl.id;
    saveCache();
    drawCatalog();
    const res = await persist();
    toast(`Сохранено: ${tpl.name}\n${res.msg}`);
  }

  function applyTemplate(tpl) {
    const text = JSON.stringify(tpl.schema, null, 2);
    const { schema, flat, issues } = validate(text);
    if (!schema) { toast(`Шаблон не применён: ${issues.find((it) => it.level === 'error')?.msg || 'ошибка схемы'}`); return; }
    stand.text = text;
    stand.comment = tpl.comment || '';
    const area = $('proto-stand-json');
    if (area) area.value = text;
    applySchema(schema, flat, issues);
    drawIssues();
    catalog.activeId = catalog.loadedId = tpl.id;
    drawCatalog();
  }

  async function deleteTemplate(tpl) {
    if (!root.confirm(`Удалить шаблон «${tpl.name}»?`)) return;
    catalog.templates = catalog.templates.filter((t) => t !== tpl);
    catalog.unsaved.delete(tpl.id);
    catalog.deleted.add(tpl.id);
    saveCache();
    if (catalog.activeId === tpl.id) reset(); else drawCatalog();
    const res = catalog.handle ? await persist() : null;
    toast(`Удалено: ${tpl.name}${res && !res.ok ? `\n${res.msg}` : ''}`);
  }

  async function openCatalogFile() {
    if (!catalog.handle) return;
    if (!(await access(catalog.handle, true))) { toast('Нет доступа к файлу каталога'); return; }
    try { await readCatalogFile(catalog.handle); toast(`Каталог: ${catalog.fileName} · ${catalog.templates.length} ${plural(catalog.templates.length, ['шаблон', 'шаблона', 'шаблонов'])}`); } catch (error) {
      catalog.status = 'unread';
      toast(error?.message === 'format' ? 'Файл не похож на каталог шаблонов' : `Файл не прочитан: ${error?.message || error}`);
    }
    drawCatalog();
  }

  // Import: файл выбирается и становится каталогом (его handle — для последующих записей).
  async function importCatalog() {
    let h = null;
    let text;
    let fileName = '';
    if (typeof root.showOpenFilePicker === 'function') {
      try { [h] = await root.showOpenFilePicker({ ...PICKER, types: FILE_TYPES, multiple: false }); } catch (error) { if (error?.name !== 'AbortError') toast(`Файл не выбран: ${error?.message || error}`); return; }
      fileName = h.name || '';
      try { text = await readHandle(h); } catch (error) { toast(`Файл не прочитан: ${error?.message || error}`); return; }
    } else {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'application/json,.json' });
      const file = await new Promise((resolve) => { input.addEventListener('change', () => resolve(input.files?.[0] || null), { once: true }); input.click(); });
      if (!file) return;
      fileName = file.name;
      text = await file.text();
    }
    if (importBasicText(text, fileName)) return;
    const list = parseCatalog(text);
    if (!list) { toast('Файл не похож на каталог шаблонов'); return; }
    if (catalog.templates.length && !root.confirm(`Заменить текущий каталог (${catalog.templates.length} ${plural(catalog.templates.length, ['шаблон', 'шаблона', 'шаблонов'])}) шаблонами из файла (${list.length})?`)) return;
    catalog.templates = list;
    catalog.unsaved.clear();
    catalog.deleted.clear();
    if (h) { Object.assign(catalog, { handle: h, fileName: h.name || 'stand-templates.json', loaded: true, status: 'ready' }); idbSetHandle(h); }
    if (catalog.activeId && !list.some((t) => t.id === catalog.activeId)) { catalog.activeId = null; catalog.loadedId = null; }
    saveCache();
    drawCatalog();
    const open = list.find((t) => t.id === catalog.activeId) || list[0];
    if (open) applyTemplate(open);
    toast(`Каталог: ${h ? catalog.fileName : 'из файла'} · ${list.length} ${plural(list.length, ['шаблон', 'шаблона', 'шаблонов'])}${h ? '' : '\nНет доступа к файлам: изменения — через Export'}`);
  }

  // Файл Basic (schemaVersion + steps) → шаблон каталога и схема на холсте.
  function importBasicText(text, fileName) {
    let doc;
    try { doc = JSON.parse(text); } catch (error) { return false; }
    if (!isObj(doc) || !('schemaVersion' in doc) || !Array.isArray(doc.steps)) return false;
    // Имя файла «Название v2.json»: номер версии уходит в version схемы, остальное — название.
    const base = fileName.replace(/\.json$/i, '');
    const ver = /^(.+?) v(\d+)$/.exec(base);
    const { schema, warnings } = root.ProtoBasicExport.fromBasic(doc, { name: ver ? ver[1] : base });
    if (ver && Number(ver[2]) >= 1) schema.version = Number(ver[2]);
    const now = new Date().toISOString();
    const tpl = { id: uid(), name: uniqueName(cut(schema.task, 48)), savedAt: now, schema: pickSchema(schema), comment: '' };
    catalog.templates.push(tpl);
    catalog.unsaved.add(tpl.id);
    saveCache();
    applyTemplate(tpl);
    persist().then((res) => toast(`Импорт из Basic: ${tpl.name}${warnings.length ? `\n${warnings.join('\n')}` : ''}\n${res.msg}`));
    return true;
  }

  // Export: схема на холсте → файл, который принимает кнопка Import в Basic.
  function exportCatalog() {
    if (!stand.active || !stand.schema) { toast('Сначала примените схему (кнопка i) или откройте шаблон'); return; }
    const { schema, warnings } = root.ProtoBasicExport.toBasic(pickSchema(stand.schema), { roleIdOf });
    if (!schema.steps.length) { toast(`Нечего экспортировать\n${warnings.join('\n')}`); return; }
    // Тот же проверяющий код, что у Import в Basic: недопустимый файл не пишем.
    const errors = root.BasicSchema?.validate(schema) || [];
    if (errors.length) { toast(`Экспорт в Basic невозможен: ${errors.slice(0, 3).map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join('; ')}${warnings.length ? `\n${warnings.slice(0, 4).join('\n')}` : ''}`); return; }
    const name = (own(stand.schema.task) ? cut(stand.schema.task, 48) : 'schema').replace(/[\\/:*?"<>|]+/g, ' ').trim();
    const versioned = `${name} v${Number.isInteger(stand.schema.version) && stand.schema.version >= 1 ? stand.schema.version : 1}`;
    const text = JSON.stringify(schema, null, 2);
    const note = warnings.length ? `\n${warnings.join('\n')}` : '';
    const download = () => {
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: `${versioned}.json` });
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`Скачан ${versioned}.json для Basic${note}`);
    };
    if (typeof root.showSaveFilePicker !== 'function') { download(); return; }
    root.showSaveFilePicker({ ...PICKER, suggestedName: `${versioned}.json`, types: FILE_TYPES }).then(async (h) => {
      const w = await h.createWritable();
      await w.write(text);
      await w.close();
      toast(`Сохранён ${h.name} для Basic${note}`);
    }).catch((error) => { if (error?.name !== 'AbortError') download(); });
  }

  // Пункт списка — разметка настоящего UI (results.js, buildPipelineItem).
  function itemHtml(name, title, active, attrs, deletable) {
    return `<div class="pipeline-item${active ? ' active' : ''}" data-name="${esc(name)}"${attrs}>
      <span class="pipeline-item-main"><input type="radio" name="pipeline" class="pipeline-radio"${active ? ' checked' : ''}><span class="pipeline-item-name" data-tip="${esc(name)}" data-desc="${esc(title)}">${esc(name)}</span></span>${deletable
      ? '<button type="button" class="pipeline-item-delete" title="Удалить шаблон" aria-label="Удалить шаблон">×</button>' : ''}</div>`;
  }
  function drawCatalog() {
    const box = $('pipelineItems');
    if (!box) return;
    const status = catalog.status === 'none' ? 'Каталог: нет файла'
      : `Каталог: ${catalog.fileName}${catalog.status === 'prompt' ? ' · нет доступа' : catalog.status === 'unread' ? ' · не прочитан' : ''}`;
    const date = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? String(iso || '') : d.toLocaleString('ru-RU'); };
    box.innerHTML = `<div class="proto-catalog-status" title="${esc(status)}">${esc(status)}</div>${itemHtml('Default', 'Исходный холст', !stand.active, ' data-catalog-default', false)}${catalog.templates.map((t) => {
      const n = countSteps(t.schema);
      return itemHtml(t.name, `${n} ${plural(n, ['этап', 'этапа', 'этапов'])} · ${date(t.savedAt)}${own(t.schema?.description) ? `\n${cut(t.schema.description, 300)}` : ''}`, stand.active && t.id === catalog.activeId, ` data-template-id="${esc(t.id)}"`, true);
    }).join('')}${catalog.status === 'prompt' ? `<div class="pipeline-item proto-catalog-open" data-catalog-open title="Разрешить доступ и прочитать файл">
      <span class="pipeline-item-main"><i class="ti ti-folder-open" aria-hidden="true"></i><span class="pipeline-item-name">Открыть каталог: ${esc(catalog.fileName)}</span></span></div>` : ''}`;
  }

  // Долгое нажатие (≥ 600 мс без движения) показывает «×» у пункта шаблона; следующий за ним click подавляется.
  const LONG_MS = 600;
  const press = { timer: 0, hide: 0, x: 0, y: 0, item: null, suppress: false };
  const clearLongpress = () => { clearTimeout(press.hide); document.querySelectorAll('.pipeline-item.is-longpress').forEach((el) => el.classList.remove('is-longpress')); };
  // Подсказка на каждом элементе холста и списка шаблонов: один плавающий блок .entry-point-tooltip.
  // Текст: data-tip → title (переносится в data-tip, чтобы не дублировала нативная) → текст обрезанного элемента из TIP_FALLBACK.
  const TIP_FALLBACK = '.model-name, .proto-art-title, .proto-art-version, .proto-stand-line, .proto-stand-kind, .round-badge, .entry-badge';
  function bindTooltips() {
    const tip = document.createElement('div');
    tip.className = 'entry-point-tooltip';
    document.body.appendChild(tip);
    let current = null;
    const textOf = (target) => {
      const holder = target.closest('[data-tip],[title]');
      if (holder) {
        if (!holder.dataset.tip && holder.getAttribute('title')) { holder.dataset.tip = holder.getAttribute('title'); }
        if (holder.hasAttribute('title')) holder.removeAttribute('title');
        if (holder.dataset.tip) return { el: holder, text: holder.dataset.tip, desc: holder.dataset.desc || '' };
      }
      const el = target.closest(TIP_FALLBACK);
      if (el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)) {
        const text = el.textContent.split('\n').map((x) => x.trim()).filter(Boolean).join('\n').slice(0, 240);
        return { el, text };
      }
      return null;
    };
    const hide = () => { current = null; tip.classList.remove('is-visible'); };
    const place = (el, text, desc) => {
      const head = document.createElement('b');
      head.className = 'entry-point-tooltip-name';
      head.textContent = text;
      tip.replaceChildren(head);
      if (desc) { const body = document.createElement('span'); body.className = 'entry-point-tooltip-desc'; body.textContent = desc; tip.appendChild(body); }
      const r = el.getBoundingClientRect();
      const t = tip.getBoundingClientRect();   // размеры верны и при opacity 0
      const margin = 8;
      const half = t.width / 2;
      const cx = Math.min(Math.max(r.left + r.width / 2, margin + half), Math.max(margin + half, window.innerWidth - margin - half));
      let top = r.top - margin - t.height;
      if (top < margin) top = r.bottom + margin;
      if (top + t.height > window.innerHeight - margin) top = window.innerHeight - t.height - margin;
      tip.style.left = `${cx}px`;
      tip.style.top = `${Math.max(margin, top)}px`;
      tip.classList.add('is-visible');
    };
    document.addEventListener('pointerover', (event) => {
      if (event.target.closest?.('.entry-point-tooltip')) return;
      const found = event.target.closest ? textOf(event.target) : null;
      if (!found || !found.text) { hide(); return; }
      if (found.el === current && tip.classList.contains('is-visible')) return;
      current = found.el;
      place(found.el, found.text, found.desc);
    });
    document.addEventListener('pointerout', (event) => { if (!event.relatedTarget) hide(); });
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('scroll', hide, { passive: true, capture: true });
    window.addEventListener('blur', hide);
  }
  function bindCatalog() {
    const box = $('pipelineItems');
    if (!box) return;
    box.addEventListener('pointerdown', (event) => {
      press.suppress = false;
      clearTimeout(press.timer);
      const item = event.target.closest('.pipeline-item[data-template-id]');
      if (!item || event.target.closest('.pipeline-item-delete')) return;
      Object.assign(press, { item, x: event.clientX, y: event.clientY });
      press.timer = setTimeout(() => {
        clearLongpress();
        item.classList.add('is-longpress');
        press.suppress = true;
        press.hide = setTimeout(clearLongpress, 6000);
      }, LONG_MS);
    });
    box.addEventListener('pointermove', (event) => { if (press.timer && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) clearTimeout(press.timer); });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach((type) => box.addEventListener(type, () => clearTimeout(press.timer)));
    box.addEventListener('contextmenu', (event) => { if (event.target.closest('.pipeline-item[data-template-id]')) event.preventDefault(); });
    // Клики по списку обрабатывает каталог (раньше обработчика холста).
    box.addEventListener('click', (event) => {
      event.stopPropagation();
      const t = event.target;
      if (press.suppress) { press.suppress = false; event.preventDefault(); return; }
      const item = t.closest('.pipeline-item');
      if (!item) return;
      if (item.hasAttribute('data-catalog-open')) { openCatalogFile(); return; }
      if (item.hasAttribute('data-catalog-default')) { reset(); return; }
      const tpl = catalog.templates.find((x) => x.id === item.dataset.templateId);
      if (!tpl) return;
      if (t.closest('.pipeline-item-delete')) { event.preventDefault(); deleteTemplate(tpl); return; }
      applyTemplate(tpl);
    }, true);
    document.addEventListener('pointerdown', (event) => { if (!event.target.closest?.('.pipeline-item.is-longpress')) clearLongpress(); }, true);
    window.addEventListener('keydown', (event) => { if (event.key === 'Escape') clearLongpress(); }, true);
    // Кнопки шапки панели: Save / Import / Export — каталог шаблонов (перехват раньше обработчиков холста).
    window.addEventListener('click', (event) => {
      const btn = event.target.closest?.('#pipeline-save-btn, #pipeline-import-btn, #pipeline-export-btn');
      if (!btn) return;
      event.preventDefault();
      event.stopPropagation();
      if (btn.id === 'pipeline-save-btn') saveTemplate();
      else if (btn.id === 'pipeline-import-btn') importCatalog();
      else exportCatalog();
    }, true);
    const titles = { 'pipeline-save-btn': 'Сохранить схему шаблоном в каталог', 'pipeline-import-btn': 'Открыть файл каталога шаблонов или схему Basic', 'pipeline-export-btn': 'Скачать схему для Basic' };
    Object.entries(titles).forEach(([id, text]) => { const b = $(id); if (b) { b.title = text; b.setAttribute('aria-label', text); } });
    loadCache();
    drawCatalog();
    idbGetHandle().then(restore, () => restore(null));
  }

  document.title = `${document.title} · v${STAND_VERSION}`;

  // ---------- Стили стенда (только то, чего нет в настоящих стилях) ----------
  const style = document.createElement('style');
  style.textContent = `
    .model-block.proto-stand-card { height: auto; min-height: var(--pipeline-block-height); justify-content: flex-start; gap: 3px; cursor: pointer; }
    .proto-stand-icon { font-size: 14px; color: var(--pipeline-muted); flex: 0 0 auto; }
    .proto-stand-line { display: block; font-size: 10px; line-height: 1.35; color: var(--pipeline-muted); overflow-wrap: anywhere; }
    .proto-stand-app { font-weight: 600; color: var(--pipeline-text); }
    #pipelineFlow .model-stack { min-height: var(--proto-stack-h, 0px); }
    .proto-stand-meta { width: 139px; margin-top: 12px; }
    .proto-stand-kind { background: #f1f5f9; color: #64748b; text-transform: uppercase; }
    .proto-stand-bang { flex: 0 0 auto; display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: #dc2626; color: #fff; font-size: 10px; font-weight: 700; cursor: help; }
    .proto-stand-bang.is-warn { background: #f59e0b; }
    .proto-stand-meta > .proto-stand-bang { float: right; }
    .proto-stand-actions { display: flex; gap: 8px; justify-self: end; flex-wrap: wrap; }
    .proto-stand-actions .modal-button { padding: 6px 14px; font-size: 13px; }
    #proto-stand-modal .custom-card-field textarea { font-family: ui-monospace, Menlo, monospace; font-size: 12px; line-height: 1.5; }
    .proto-stand-issues { max-height: 180px; overflow: auto; margin-top: 8px; font-size: 12px; line-height: 1.5; }
    .proto-stand-issues:empty { display: none; }
    .proto-stand-issues .is-error { color: #b91c1c; }
    .proto-stand-issues .is-warn { color: #b45309; }
    .proto-stand-comment { margin-top: 6px; color: var(--pipeline-text); }
    .proto-stand-comment summary { cursor: pointer; font-weight: 600; }
    .proto-stand-comment > div { white-space: pre-wrap; overflow-wrap: anywhere; margin-top: 4px; }
    .proto-stand-summary { font-weight: 600; color: var(--pipeline-text); }
    .proto-stand-schema { grid-template-columns: 1fr; }
    .proto-stand-desc { margin-bottom: 10px; }
    .proto-stand-desc-head { display: flex; justify-content: space-between; align-items: center; }
    .proto-stand-desc-toggle { border: 0; background: none; cursor: pointer; font-size: 16px; color: var(--pipeline-muted); }
    .proto-stand-desc-text { white-space: pre-wrap; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; color: var(--pipeline-text); }
    .proto-stand-desc.is-full { position: fixed; inset: 0; z-index: 10000; background: var(--pipeline-surface, #fff); padding: 16px 24px; overflow: auto; margin: 0; }
    .proto-stand-desc.is-full .proto-stand-desc-text { display: block; overflow: visible; }
    #proto-stand-info .modal-content { height: auto; max-height: calc(100dvh - 32px); }
    .proto-stand-rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin-top: 6px; }
    .proto-stand-row { display: contents; }
    .proto-stand-row > span { color: var(--pipeline-muted); white-space: nowrap; }
    .proto-stand-row > div { color: var(--pipeline-text); white-space: pre-wrap; overflow-wrap: anywhere; }
    .pipeline-item.is-longpress .pipeline-item-delete { opacity: 1; pointer-events: auto; }
    .pipeline-item[data-template-id] { -webkit-touch-callout: none; user-select: none; }
    .proto-catalog-status { line-height: 25px; font-size: 11px; color: var(--pipeline-muted); opacity: 0.85; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .proto-catalog-open .ti { font-size: 14px; color: var(--pipeline-muted); }
    #proto-stand-toast { position: fixed; left: 50%; bottom: 24px; z-index: 100000; transform: translate(-50%, 8px); max-width: min(480px, calc(100vw - 32px));
      padding: 7px 14px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; color: var(--pipeline-text); box-shadow: 0 6px 20px rgba(15, 23, 42, 0.14);
      font-size: 12px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; text-align: center; opacity: 0; pointer-events: none; transition: opacity 0.15s ease, transform 0.15s ease; }
    #proto-stand-toast.is-visible { opacity: 1; transform: translate(-50%, 0); }
  `;
  document.head.appendChild(style);

  // ---------- Примеры ----------
  const EXAMPLES = {
    "basic": {
      "task": "Подготовить план запуска нового тарифа для малого бизнеса",
      "artifacts": [
        {
          "name": "Бриф",
          "description": "Исходные данные о тарифе для всех моделей",
          "content": "Тариф «Старт» для малого бизнеса: 5 пользователей, 990 ₽ в месяц, запуск через 6 недель."
        }
      ],
      "steps": [
        {
          "id": "s1",
          "block": "round",
          "title": "Первые планы",
          "task": "Предложи план запуска тарифа по брифу.",
          "models": [
            {
              "name": "Claude",
              "role": "автор",
              "task": "Сделай упор на сроки и этапы."
            },
            {
              "name": "GPT",
              "role": "критик",
              "task": "Ищи риски и слабые места."
            },
            {
              "name": "Gemini",
              "role": "аналитик",
              "task": "Оцени рынок и цены."
            }
          ],
          "inputs": [
            "in.Бриф"
          ],
          "artifacts": [
            "Черновики"
          ],
          "why": "Три независимых взгляда на одну задачу."
        },
        {
          "id": "s2",
          "block": "round",
          "title": "Сводный план",
          "models": [
            {
              "name": "Claude",
              "role": "свести"
            }
          ],
          "task": "Сведи черновики в один план.",
          "inputs": [
            "s1.Черновики"
          ],
          "artifacts": [
            "План"
          ],
          "why": "Нужен один план вместо трёх."
        },
        {
          "id": "s3",
          "block": "round",
          "title": "Проверка плана",
          "task": "Проверь по критериям: есть сроки, бюджет и ответственные; нет противоречий. Ответь «прошло» или «не прошло» и перечисли замечания.",
          "inputs": [
            "s2.План"
          ],
          "artifacts": [
            {
              "name": "Вердикт",
              "description": "Вердикт «прошло» или «не прошло» с замечаниями"
            }
          ],
          "why": "Не отдавать план без сроков и бюджета.",
          "models": [
            {
              "name": "GPT",
              "role": "проверяющий"
            }
          ]
        },
        {
          "id": "s4",
          "block": "owner",
          "title": "Решение по проверке",
          "ask": "Прочитайте вердикт и напишите «доработать» или «утвердить».",
          "inputs": [
            "s3.Вердикт"
          ],
          "artifacts": [
            {
              "name": "Решение",
              "description": "Слово «доработать» или «утвердить» и пожелания User"
            }
          ],
          "why": "Нужна ли доработка плана, решает User."
        },
        {
          "id": "s5a",
          "block": "round",
          "title": "Доработка (1/3)",
          "task": "Исправь план по замечаниям проверки и решению User. Если доработка не нужна, верни план без изменений.",
          "models": [
            {
              "name": "Claude",
              "role": "автор"
            }
          ],
          "inputs": [
            "s2.План",
            "s3.Вердикт",
            "s4.Решение"
          ],
          "artifacts": [
            "Правки"
          ],
          "why": "Закрыть замечания проверки."
        },
        {
          "id": "s5b",
          "block": "round",
          "title": "Доработка (2/3)",
          "task": "Исправь план по замечаниям проверки и решению User. Если доработка не нужна, верни план без изменений.",
          "models": [
            {
              "name": "GPT",
              "role": "критик"
            }
          ],
          "inputs": [
            "s2.План",
            "s3.Вердикт",
            "s4.Решение",
            "s5a.Правки"
          ],
          "artifacts": [
            "Правки"
          ],
          "why": "Закрыть замечания проверки."
        },
        {
          "id": "s5c",
          "block": "round",
          "title": "Доработка (3/3)",
          "task": "Исправь план по замечаниям проверки и решению User. Если доработка не нужна, верни план без изменений.",
          "models": [
            {
              "name": "Gemini",
              "role": "аналитик"
            }
          ],
          "inputs": [
            "s2.План",
            "s3.Вердикт",
            "s4.Решение",
            "s5a.Правки",
            "s5b.Правки"
          ],
          "artifacts": [
            "Правки"
          ],
          "why": "Закрыть замечания проверки."
        },
        {
          "id": "s6",
          "block": "round",
          "title": "Итоговый план",
          "models": [
            {
              "name": "GPT",
              "role": "судья"
            }
          ],
          "task": "Собери итоговый план с учётом правок.",
          "inputs": [
            "s2.План",
            "s5a.Правки",
            "s5b.Правки",
            "s5c.Правки"
          ],
          "artifacts": [
            "Итог"
          ],
          "why": "Окончательная версия плана."
        },
        {
          "id": "s7",
          "block": "round",
          "title": "Повторная проверка плана",
          "task": "Проверь по критериям: есть сроки, бюджет и ответственные; нет противоречий. Ответь «прошло» или «не прошло» и перечисли замечания.",
          "inputs": [
            "s6.Итог"
          ],
          "why": "Итоговый план проверяется тем же критерием.",
          "models": [
            {
              "name": "GPT",
              "role": "проверяющий"
            }
          ]
        },
        {
          "id": "s8",
          "block": "file",
          "title": "Сохранить план",
          "file": "plan.md",
          "mode": "overwrite",
          "inputs": [
            "s6.Итог"
          ],
          "why": "Результат нужен файлом."
        }
      ]
    },
    "defaults": {
      "task": "Выбрать технологический стек для внутреннего сервиса заявок",
      "defaults": {
        "roundTask": "Учти ответы предыдущего раунда и улучши своё предложение.",
        "discipline": {
          "content": "Пиши по делу: варианты, плюсы, минусы, риски.",
          "lines": [
            "Не повторяй чужие аргументы дословно."
          ]
        },
        "modelNotes": {
          "Claude": "Отвечай структурно, с короткими заголовками.",
          "GPT": "Называй конкретные библиотеки и версии."
        }
      },
      "run": {
        "policy": "manual",
        "maxWords": 500
      },
      "artifacts": [
        {
          "name": "Требования",
          "description": "Одинаковые требования для всех моделей",
          "content": "Внутренний сервис заявок: до 200 пользователей, интеграция с почтой, срок разработки 3 месяца, команда из 4 человек."
        }
      ],
      "steps": [
        {
          "id": "s1",
          "block": "round",
          "title": "Первые предложения",
          "task": "Предложи стек для сервиса по требованиям.",
          "models": [
            {
              "name": "Claude",
              "role": "архитектор",
              "maxWords": 700,
              "discipline": {
                "lines": [
                  "Начни со схемы архитектуры в 3–5 пунктах."
                ]
              }
            },
            {
              "name": "GPT",
              "role": "критик",
              "task": "Ищи слабые места каждого варианта."
            },
            {
              "name": "Gemini",
              "role": "аналитик",
              "maxWords": 300
            }
          ],
          "inputs": [
            "in.Требования"
          ],
          "artifacts": [
            "Предложения"
          ],
          "why": "Три независимых предложения."
        },
        {
          "id": "s2a",
          "block": "round",
          "title": "Критика (1/2)",
          "inputs": [
            "s1.Предложения"
          ],
          "artifacts": [
            "Замечания"
          ],
          "models": [
            {
              "name": "GPT",
              "role": "критик",
              "task": "Найди в каждом предложении три главных риска и предложи, как их снизить.",
              "discipline": {
                "lines": [
                  "Риски нумеруй: 1, 2, 3."
                ]
              }
            }
          ],
          "why": "Найти риски до выбора."
        },
        {
          "id": "s2b",
          "block": "round",
          "title": "Критика (2/2)",
          "inputs": [
            "s1.Предложения",
            "s2a.Замечания"
          ],
          "artifacts": [
            "Замечания"
          ],
          "models": [
            {
              "name": "Claude",
              "role": "архитектор",
              "discipline": {
                "limit": "[RESPONSE_LIMIT] Не больше {слов} слов."
              }
            }
          ],
          "why": "Найти риски до выбора."
        },
        {
          "id": "s3",
          "block": "round",
          "title": "Доработка",
          "task": "Исправь своё предложение по замечаниям.",
          "inputs": [
            "s1.Предложения",
            "s2a.Замечания",
            "s2b.Замечания"
          ],
          "artifacts": [
            "Доработки"
          ],
          "models": [
            {
              "name": "Claude",
              "role": "архитектор"
            },
            {
              "name": "GPT",
              "role": "критик"
            },
            {
              "name": "Gemini",
              "role": "аналитик",
              "maxWords": 500
            }
          ],
          "why": "Учесть критику."
        },
        {
          "id": "s4",
          "block": "round",
          "title": "Итоговое решение",
          "models": [
            {
              "name": "Claude",
              "role": "свести",
              "maxWords": 1000,
              "discipline": {
                "lines": [
                  "В конце — таблица: компонент, выбор, причина."
                ]
              }
            }
          ],
          "inputs": [
            "s3.Доработки"
          ],
          "artifacts": [
            "Решение"
          ],
          "why": "Одно решение вместо трёх."
        }
      ]
    }
  };

  root.ProtoStand = {
    get active() { return stand.active; },
    version: STAND_VERSION, render, draw, validate, reset, open: openStand, examples: EXAMPLES,
    // Каталог шаблонов (для проверок): состояние, восстановление по handle, перерисовка списка.
    catalog: { state: catalog, restore, draw: drawCatalog, save: saveTemplate, parse: parseCatalog, text: catalogText }
  };
  const start = () => { bindFlow(); bindCatalog(); bindTooltips(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})(window);
