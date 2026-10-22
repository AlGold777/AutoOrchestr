// Стенд схем прототипа холста Basic: клавиша I (или Ш) открывает окно вставки JSON-схемы этапов,
// «Применить» проверяет схему и перерисовывает холст по ней. Раунды и синтезы схемы кладутся в
// window.ProtoState, поэтому их окна — настоящие окна cards.js; остальные блоки — окна «Из схемы».
// Холст (canvas.js) отдаёт отрисовку сюда, пока ProtoStand.active; «Сбросить» возвращает исходный холст.
(function initProtoStand(root) {
  'use strict';

  const STAND_VERSION = '15';
  const S = () => root.ProtoState;
  const cards = () => root.ProtoCards || {};
  const canvas = () => root.ProtoCanvas || {};
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const own = (value) => typeof value === 'string' && Boolean(value.trim());
  const cut = (text, n) => { const s = String(text || '').trim().replace(/\s+/g, ' '); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

  // ---------- Формат схемы ----------
  const COMMON = ['id', 'block', 'title', 'inputs', 'optional_inputs', 'artifacts', 'repeats', 'because', 'why'];
  const FIELDS = {
    round: ['models', 'order', 'task'], synthesis: ['model', 'role', 'task', 'maxWords', 'request', 'discipline'], gate: ['criteria'], route: ['choices'],
    owner: ['ask'], form: ['purpose'], source: ['kind', 'content', 'attachment'], file: ['file', 'mode'], list: ['from', 'rule'],
    foreach: ['over', 'body'], block: ['name'], assemble: ['template'], score: ['criteria', 'weights']
  };
  const KIND = {
    round: ['Раунд', 'ti-users'], synthesis: ['Синтез', 'ti-git-merge'], gate: ['Проверка', 'ti-shield-check'], route: ['Развилка', 'ti-arrows-split'],
    owner: ['Владелец', 'ti-user'], form: ['Форма', 'ti-forms'], source: ['Источник', 'ti-file-text'], file: ['Файл', 'ti-file-export'],
    list: ['Список', 'ti-list'], foreach: ['Каждый', 'ti-repeat'], block: ['Блок', 'ti-box'], assemble: ['Сборка', 'ti-stack-2'], score: ['Оценка', 'ti-star']
  };
  const MODEL_KEYS = ['name', 'role', 'task', 'maxWords', 'request', 'discipline'];
  const MODEL_NAMES = ['Claude', 'GPT', 'Gemini', 'Grok', 'Le Chat', 'Qwen', 'DeepSeek', 'Perplexity', 'Z.ai', 'Kimi'];
  const ENUMS = { order: ['parallel', 'sequential'], kind: ['text', 'document', 'link'], mode: ['overwrite', 'append', 'read'] };
  const LABELS = {
    id: 'этап', block: 'блок', title: 'название', why: 'зачем', inputs: 'вход', optional_inputs: 'вход, если этап был', artifacts: 'артефакты', repeats: 'повтор', because: 'условие повтора',
    models: 'модели', order: 'порядок', task: 'задание', model: 'модель', role: 'роль', criteria: 'критерии', choices: 'варианты', ask: 'вопрос',
    purpose: 'цель', kind: 'вид', file: 'файл', mode: 'режим', from: 'из', rule: 'правило', over: 'по', body: 'тело', name: 'имя',
    template: 'шаблон', content: 'содержимое', attachment: 'приложенный файл', weights: 'веса', maxWords: 'предел слов', request: 'свой запрос', discipline: 'дисциплина',
    defaults: 'общие значения ▶', run: 'запуск'
  };
  const DISC_LABELS = { limit: 'длина', content: 'содержание', delivery: 'доставка', correction: 'повторный запрос', lines: 'строки' };
  const POLICY_TEXT = { auto: 'автоматически', manual: 'вручную' };
  const ORDER_TEXT = { parallel: 'параллельно', sequential: 'по очереди' };
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
      if (k === 'body') return;
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
        if (b !== st.block && FIELDS[b]) { fixed(`block «${st.block}» → «${b}».`); st.block = b; }
      }
      if (st.title == null && st.block !== 'block' && own(st.name)) { st.title = st.name; delete st.name; fixed('«name» вместо «title» — переименовано.'); }
      if (st.inputs == null) {
        const a = ['input', 'depends_on', 'requires'].find((k) => st[k] != null);
        if (a) { st.inputs = st[a]; delete st[a]; fixed(`«${a}» вместо «inputs» — переименовано.`); }
      }
      ['inputs', 'optional_inputs', 'artifacts'].forEach((k) => { if (typeof st[k] === 'string') { st[k] = [st[k]]; fixed(`${k} строкой — превращён в список.`); } });
      if (Array.isArray(st.models) && st.models.some((m) => typeof m === 'string')) {
        st.models = st.models.map((m) => (typeof m === 'string' ? { name: m.trim() } : m));
        fixed('models списком имён — превращён в объекты { name }.');
      }
      stubs(st, '', key, add);
      if (st.block === 'foreach' && st.body != null) {
        st.body = mapToList(st.body, `${key}.body`, key, add);
        fixSteps(st.body, `${key}.body`, add);
      }
    });
  }
  // Новые поля: предел слов, дисциплина, defaults, run.
  const DISC_KEYS = ['limit', 'content', 'delivery', 'correction', 'lines'];
  const DEFAULTS_KEYS = ['roundTask', 'synthesisTask', 'discipline', 'modelNotes'];
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
      if (!isObj(d)) add('warn', null, 'defaults должен быть объектом { roundTask, synthesisTask, discipline, modelNotes }; не применён.');
      else {
        Object.keys(d).filter((k) => !DEFAULTS_KEYS.includes(k)).forEach((k) => add('warn', null, `defaults.${k}: неизвестное поле; допустимы ${DEFAULTS_KEYS.join(', ')}.`));
        ['roundTask', 'synthesisTask'].forEach((k) => checkText(d, k, 'defaults.', null, add));
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
    checkText(owner, 'request', where, key, add);
    checkDiscipline(owner.discipline, where, key, add);
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
    Object.keys(schema).filter((k) => !['task', 'steps', 'defaults', 'run'].includes(k)).forEach((k) => add('warn', null, `Неизвестное поле схемы «${k}».`));
    if (!own(schema.task)) add('warn', null, 'Нет task — фразы задачи.');
    else if (STUB.test(schema.task)) add('warn', null, `Заглушка вместо текста в поле task: «${cut(schema.task, 30)}» — модель сократила ответ.`);
    if (!Array.isArray(schema.steps) || !schema.steps.length) { add('error', null, 'steps должен быть непустым списком этапов.'); return fail(); }
    checkRoot(schema, add);
    fixSteps(schema.steps, 'steps', add);

    // Порядок проверки ссылок: этапы списка, тело foreach — сразу после самого foreach.
    const flat = [];
    const walk = (steps, parent) => steps.forEach((step, i) => {
      const entry = { step: step && typeof step === 'object' && !Array.isArray(step) ? step : {}, key: '', pos: flat.length, parent, raw: step };
      entry.key = own(entry.step.id) ? entry.step.id : `${parent ? `${parent.key}.body` : 'steps'}[${i}]`;
      flat.push(entry);
      if (entry.step.block === 'foreach' && Array.isArray(entry.step.body)) walk(entry.step.body, entry);
    });
    walk(schema.steps, null);
    // Повтор наследует настройки повторяемого этапа: models, model, order, role, если у него их нет.
    const firstById = new Map();
    flat.forEach((e) => { if (own(e.step.id) && !firstById.has(e.step.id)) firstById.set(e.step.id, e); });
    flat.forEach((e) => {
      const src = own(e.step.repeats) ? firstById.get(e.step.repeats) : null;
      if (!src || src.pos >= e.pos || src.step.block !== e.step.block) return;
      ['models', 'model', 'order', 'role'].forEach((k) => {
        if (e.step[k] == null && src.step[k] != null) { e.step[k] = JSON.parse(JSON.stringify(src.step[k])); (e.inherited = e.inherited || []).push(k); }
      });
    });
    const byId = new Map();
    flat.forEach((e) => {
      const st = e.step;
      if (e.raw !== st) {
        add('error', e.key, typeof e.raw === 'string' && STUB.test(e.raw) ? `Заглушка «${cut(e.raw, 20)}» вместо этапа — модель сократила ответ; попросите полный список этапов.` : 'Этап должен быть объектом.');
        return;
      }
      if (!own(st.id)) add('error', e.key, 'Нет id.');
      else if (byId.has(st.id)) add('error', e.key, `id «${st.id}» повторяется.`);
      else byId.set(st.id, e);
      if (!FIELDS[st.block]) add('error', e.key, st.block ? `Неизвестный блок «${st.block}».` : 'Нет block.');
      if (!own(st.title)) add('error', e.key, 'Нет title.');
      if (!own(st.why)) add('error', e.key, 'Нет why — зачем этот этап.');
      if (FIELDS[st.block]) {
        Object.keys(st).filter((k) => !COMMON.includes(k) && !FIELDS[st.block].includes(k) && !(st.block === 'source' && k === 'title'))
          .forEach((k) => add('warn', e.key, `Неизвестное поле «${k}» для блока ${st.block}.`));
      }
      Object.entries(ENUMS).forEach(([k, values]) => {
        if (st[k] != null && FIELDS[st.block]?.includes(k) && !values.includes(st[k])) add('warn', e.key, `${k}: «${st[k]}» — ожидается ${values.join(' | ')}.`);
      });
      ['inputs', 'artifacts'].forEach((k) => { if (st[k] != null && !Array.isArray(st[k])) add('error', e.key, `${k} должен быть списком.`); });
      if (st.block === 'round' && (!Array.isArray(st.models) || !st.models.length)) add('error', e.key, 'У раунда нет models.');
      if (st.block === 'round' && Array.isArray(st.models)) st.models.forEach((m, i) => {
        if (!own(m?.name)) add('error', e.key, `models[${i}]: нет name.`);
        if (!isObj(m) || e.inherited?.includes('models')) return;
        Object.keys(m).filter((k) => !MODEL_KEYS.includes(k)).forEach((k) => add('warn', e.key, `models[${i}].${k}: неизвестное поле модели; допустимы ${MODEL_KEYS.join(', ')}.`));
        checkOwnFields(m, `models[${i}].`, e.key, add);
      });
      if (st.block === 'synthesis' && !own(st.model)) add('warn', e.key, 'У синтеза нет model.');
      if (st.block === 'synthesis') checkOwnFields(st, '', e.key, add);
      if (st.block === 'source' && !own(st.content) && !own(st.attachment)) add('warn', e.key, 'Материал не передан: нет ни content (текст), ни attachment (имя файла, приложенного к ответу).');
      if (own(st.attachment) && !/\.[A-Za-z0-9]{1,8}$/.test(st.attachment.trim())) add('warn', e.key, `attachment «${st.attachment}»: нужно точное имя файла с расширением.`);
      if (st.block === 'route' && !Array.isArray(st.choices)) add('error', e.key, 'У route нет choices.');
      if (st.block === 'foreach' && !Array.isArray(st.body)) add('error', e.key, 'У foreach нет body (списка этапов).');
      if (own(st.repeats) && !own(st.because)) add('error', e.key, `Повтор ${st.repeats} без because.`);
      if (own(st.because) && !own(st.repeats)) add('warn', e.key, 'because без repeats.');
    });
    // Ссылки: вверх — inputs/repeats/over/from; вниз — route.goes.
    flat.forEach((e) => {
      const st = e.step;
      const refs = [];
      if (Array.isArray(st.inputs)) st.inputs.forEach((r) => refs.push(['inputs', r, 'up']));
      if (Array.isArray(st.optional_inputs)) st.optional_inputs.forEach((r) => refs.push(['optional_inputs', r, 'up']));
      if (st.repeats != null) refs.push(['repeats', st.repeats, 'up']);
      if (st.block === 'foreach' && st.over != null) refs.push(['over', st.over, 'up']);
      if (st.block === 'list' && st.from != null) refs.push(['from', st.from, 'up']);
      if (st.block === 'route' && Array.isArray(st.choices)) st.choices.forEach((c) => listOf(c?.goes).forEach((r) => refs.push(['goes', r, 'down'])));
      refs.forEach(([field, ref, dir]) => {
        if (!own(ref)) { add('error', e.key, `${field}: пустая ссылка.`); return; }
        if (refId(ref) === 'item') {
          if (field === 'inputs' && e.parent) return;
          add('error', e.key, `${field}: «item» можно только в inputs этапов внутри body у foreach.`);
          return;
        }
        const target = byId.get(refId(ref));
        if (!target) { add('error', e.key, `${field}: этапа «${refId(ref)}» нет.`); return; }
        if (dir === 'up' && target.pos >= e.pos) add('error', e.key, `${field}: «${ref}» — ссылка ${target.pos === e.pos ? 'на себя' : 'вниз'}; можно только на этапы выше.`);
        if (dir === 'down' && target.pos <= e.pos) add('error', e.key, `goes: «${ref}» — переход назад; route ведёт только к этапам ниже.`);
        if (field === 'repeats' && target.step.block !== st.block) add('warn', e.key, `repeats: ${ref} — блок ${target.step.block}, а этот ${st.block}.`);
        const dot = String(ref).indexOf('.');
        if (dot > 0) {
          const name = String(ref).slice(dot + 1);
          if (!listOf(target.step.artifacts).includes(name)) add('error', e.key, `${field}: у ${refId(ref)} нет артефакта «${name}» в artifacts.`);
        }
      });
    });
    // Этапы, которые маршрут может пропустить: между развилкой и ближайшей целью каждого варианта.
    const conditional = new Set();
    flat.forEach((r) => {
      if (r.step.block !== 'route' || !Array.isArray(r.step.choices)) return;
      r.step.choices.forEach((c) => {
        const pos = listOf(c?.goes).map((g) => byId.get(refId(g))?.pos).filter((x) => x != null && x > r.pos);
        if (!pos.length) return;
        const first = Math.min(...pos);
        flat.forEach((x) => { if (x.pos > r.pos && x.pos < first && x.parent === r.parent) conditional.add(x.step.id); });
      });
    });
    flat.forEach((e) => {
      const st = e.step;
      listOf(st.inputs).forEach((r) => {
        if (conditional.has(refId(r)) && !conditional.has(st.id) && !listOf(st.optional_inputs).some((o) => refId(o) === refId(r))) {
          add('warn', e.key, `inputs: ${refId(r)} может быть пропущен развилкой; вынесите «${r}» в optional_inputs.`);
        }
      });
      // Петля должна заканчиваться повторной проверкой.
      if (own(st.repeats) && own(st.because)) {
        const gate = flat.find((x) => x.step.block === 'gate' && own(x.step.id) && new RegExp(`(^|[^\\w])${x.step.id}([^\\w]|$)`).test(st.because) && x.pos < e.pos);
        if (gate && !flat.some((x) => x.pos > e.pos && x.step.block === 'gate' && x.step.repeats === gate.step.id)
            && flat.find((x) => own(x.step.repeats) && own(x.step.because) && x.step.because.includes(gate.step.id)) === e) {
          add('warn', e.key, `После повтора по условию «${st.because}» нет повторной проверки: добавьте этап gate с repeats: «${gate.step.id}».`);
        }
      }
      [...(Array.isArray(st.models) ? st.models.map((m) => m?.name) : []), st.model].filter(own).forEach((n) => {
        if (!MODEL_NAMES.includes(n)) add('warn', e.key, `Неизвестное имя модели «${n}»; допустимы: ${MODEL_NAMES.join(', ')}.`);
      });
      if (st.block === 'score' && st.weights != null && (typeof st.weights !== 'object' || Array.isArray(st.weights))) {
        add('warn', e.key, 'weights должен быть объектом { "критерий": число }.');
      }
      const texts = [st.task, ...(Array.isArray(st.models) ? st.models.map((m) => m?.task) : [])].filter(own);
      if (texts.some((x) => x.includes('{item}'))) {
        if (!e.parent) add('error', e.key, '{item} в задании можно только внутри body у foreach.');
        else if (!listOf(st.inputs).includes('item')) add('warn', e.key, 'В задании есть {item}, но «item» нет в inputs.');
      }
    });
    return { schema, flat, issues, comment: ctx.comment };
  }

  // ---------- Состояние стенда ----------
  const DATA_KEYS = ['models', 'defaults', 'run', 'rounds', 'final', 'selectedModel'];
  const stand = { active: false, layout: [], issues: [], flat: [], schema: null, snapshot: null, name: null, current: null, text: '', comment: '' };

  // Дисциплина и свои поля модели/синтеза схемы → поля ProtoState.
  function disciplineOf(d) {
    const out = S().emptyDiscipline();
    if (!isObj(d)) return out;
    DISC_KEYS.slice(0, 4).forEach((k) => { if (own(d[k])) out[k] = d[k].trim(); });
    out.lines = listOf(d.lines).filter(own).map((x) => x.trim());
    return out;
  }
  const ownFields = (o) => ({ request: own(o.request) ? o.request.trim() : '', maxWords: wordsOf(o.maxWords), discipline: disciplineOf(o.discipline) });

  // Схема → ProtoState: раунды и синтезы в порядке списка; layout — колонки холста.
  function applySchema(schema, flat, issues) {
    const state = S();
    if (!stand.snapshot) {
      stand.snapshot = JSON.parse(JSON.stringify(DATA_KEYS.reduce((o, k) => ({ ...o, [k]: state[k] }), {})));
      stand.name = $('currentPipelineName')?.textContent || 'Default';
    }
    const steps = schema.steps.filter((st) => st && typeof st === 'object');
    const names = new Set(stand.snapshot.models);
    steps.forEach((st) => { listOf(st.models).forEach((m) => own(m?.name) && names.add(m.name)); if (own(st.model)) names.add(st.model); });
    state.models = [...names];
    // defaults / run схемы поверх значений, бывших до первого «Применить».
    const clone = (value) => JSON.parse(JSON.stringify(value));
    const snapD = clone(stand.snapshot.defaults || {});
    const d = isObj(schema.defaults) ? schema.defaults : {};
    const notes = isObj(d.modelNotes) ? Object.fromEntries(Object.entries(d.modelNotes).filter(([, v]) => own(v)).map(([n, v]) => [n, v.trim()])) : {};
    state.defaults = { ...snapD,
      roundTask: own(d.roundTask) ? d.roundTask.trim() : snapD.roundTask || '',
      synthesisTask: own(d.synthesisTask) ? d.synthesisTask.trim() : snapD.synthesisTask || '',
      discipline: isObj(d.discipline) ? disciplineOf(d.discipline) : snapD.discipline || state.emptyDiscipline(),
      modelNotes: { ...(snapD.modelNotes || {}), ...notes }, roundPrompts: snapD.roundPrompts || {} };
    const r = isObj(schema.run) ? schema.run : {};
    state.run = { ...clone(stand.snapshot.run || {}), ...(['auto', 'manual'].includes(r.policy) ? { policy: r.policy } : {}), ...(wordsOf(r.maxWords) ? { maxWords: wordsOf(r.maxWords) } : {}) };
    state.rounds = [];
    const lastSynth = steps.map((st) => st.block).lastIndexOf('synthesis');
    const finalAt = lastSynth >= 0 && !steps.slice(lastSynth + 1).some((st) => st.block === 'round') ? lastSynth : -1;
    let final = null;
    stand.layout = steps.map((st, i) => {
      const col = { step: st, key: flat.find((e) => e.raw === st)?.key || st.id };
      if (st.block === 'round') {
        const index = state.rounds.length;
        const inputs = listOf(st.inputs);
        state.rounds.push({
          ref: own(st.id) ? st.id : `r${index + 1}`,
          order: ENUMS.order.includes(st.order) ? st.order : '',
          input: inputs.length ? (inputs.length > 1 ? 'all' : 'previous') : (index === 0 ? '' : 'none'),
          task: own(st.task) ? st.task : '', role: 'None',
          models: listOf(st.models).filter((m) => m && typeof m === 'object').map((m) => {
            const id = roleIdOf(m.role);
            const roleLine = own(m.role) && !id ? `Роль: ${m.role.trim()}.` : '';
            return { name: String(m.name || '?'), enabled: true, send: true, role: id || 'None', schemaRole: own(m.role) ? m.role.trim() : '',
              task: [roleLine, own(m.task) ? m.task.trim() : ''].filter(Boolean).join('\n\n'), ...ownFields(m) };
          }),
          intermediateSynthesis: null,
          artifacts: listOf(st.artifacts).map((title, k) => ({ id: `${st.id}-a${k + 1}`, title: String(title), version: 1 }))
        });
        col.round = index;
      } else if (st.block === 'synthesis') {
        col.synth = { model: own(st.model) ? st.model : (state.models.includes('Claude') ? 'Claude' : state.models[0]),
          task: [own(st.role) ? `Роль: ${st.role.trim()}.` : '', own(st.task) ? st.task.trim() : ''].filter(Boolean).join('\n\n'),
          ...ownFields(st) };
        col.after = state.rounds.length - 1; // раунд, после которого стоит синтез (−1 — раундов выше нет)
        if (i === finalAt) { col.final = true; col.synth.on = true; final = col.synth; }
      }
      return col;
    });
    // Промежуточный синтез между раундами — в слот раунда, после которого он стоит.
    stand.layout.forEach((col) => {
      const round = col.synth && !col.final && col.after >= 0 && col.after < state.rounds.length - 1 ? state.rounds[col.after] : null;
      if (round && !round.intermediateSynthesis) round.intermediateSynthesis = col.synth;
    });
    state.final = final || { on: false, model: state.models.includes('Claude') ? 'Claude' : state.models[0], task: '', discipline: state.emptyDiscipline() };
    stand.schema = schema;
    stand.flat = flat;
    stand.issues = issues;
    stand.active = true;
    const name = $('currentPipelineName');
    if (name) { name.textContent = own(schema.task) ? cut(schema.task, 60) : 'Схема'; name.title = schema.task || ''; }
    render();
  }

  function reset() {
    const state = S();
    if (stand.snapshot) DATA_KEYS.forEach((k) => { state[k] = stand.snapshot[k]; });
    const name = $('currentPipelineName');
    if (name && stand.name != null) { name.textContent = stand.name; name.title = ''; }
    Object.assign(stand, { active: false, layout: [], issues: [], flat: [], schema: null, snapshot: null, name: null, current: null, comment: '' });
    canvas().render?.();
    drawIssues();
  }

  // ---------- Холст ----------
  const issuesOf = (key) => stand.issues.filter((it) => it.step === key);
  const bang = (key) => {
    const list = issuesOf(key);
    if (!list.length) return '';
    const err = list.some((it) => it.level === 'error');
    return `<span class="proto-stand-bang${err ? '' : ' is-warn'}" title="${esc(list.map((it) => it.msg).join('\n'))}">!</span>`;
  };
  const inputsText = (st, skip) => {
    const rest = listOf(st.inputs).filter((r) => refId(r) !== skip);
    return rest.length ? `<div class="proto-stand-line">вход: ${esc(rest.join(', '))}</div>` : '';
  };
  const repeatText = (st) => (own(st.repeats) ? `<div class="proto-stand-line proto-stand-repeat">повтор ${esc(st.repeats)}${own(st.because) ? ` · ${esc(st.because)}` : ''}</div>` : '');
  const artifactsHtml = (list) => {
    const items = list.length
      ? list.map((t) => `<span class="proto-artifact" title="${esc(t)} v1"><span class="proto-artifact-title">${esc(t)}</span><span class="proto-artifact-version">v1</span></span>`).join('')
      : '<span class="proto-artifacts-empty">—</span>';
    return `<div class="proto-artifacts" aria-disabled="true"><div class="proto-artifacts-label">Артефакты</div><div class="proto-artifacts-row">${items}</div></div>`;
  };
  const modelBlock = (model, index) => {
    const on = model.enabled !== false;
    const send = on && model.send !== false;
    const options = ROLE_OPTIONS.map(([value, label]) => {
      const text = value === 'None' && model.schemaRole && !roleIdOf(model.schemaRole) ? model.schemaRole : label;
      return `<option value="${esc(value)}"${(model.role || 'None') === value ? ' selected' : ''}>${esc(text)}</option>`;
    }).join('');
    return `<div class="model-block ${on ? 'active' : 'inactive'} with-role" data-index="${index}" data-model="${esc(model.name)}">
        <div class="model-header">
          <span class="status-indicator" data-llm-name="${esc(model.name)}"></span>
          <input type="checkbox" class="model-checkbox model-input-checkbox"${on ? ' checked' : ''} aria-label="Input" title="Input">
          <span class="model-name" title="${esc(model.schemaRole ? `${model.name} — ${model.schemaRole}` : model.name)}">${esc(model.name)}</span>
          <input type="checkbox" class="model-checkbox model-send-checkbox"${send ? ' checked' : ''}${on ? '' : ' disabled'} aria-label="Send" title="Send">
        </div>
        <select class="role-selector judge-prompt-selector"${on ? '' : ' disabled'}>${options}</select>
      </div>`;
  };
  const nestedHtml = (body) => `<details class="proto-stand-body"><summary>Этапы: ${listOf(body).length}</summary>${listOf(body).map((sub) => {
    const key = stand.flat.find((e) => e.raw === sub)?.key || '';
    return `<div class="proto-stand-sub" data-stand-key="${esc(key)}" title="Двойной клик — поля этапа">${esc(sub?.id || '?')} · ${esc(KIND[sub?.block]?.[0] || sub?.block || '?')} — ${esc(cut(sub?.title, 40))}${bang(key)}</div>`;
  }).join('')}</details>`;

  function columnHtml(col, k, prevId) {
    const st = col.step;
    const key = col.key;
    const stack = `stand-stack-${k}`;
    const head = (badge, extra = '') => `<div class="stage-label"><span class="round-badge${extra}">${badge}</span></div>`;
    const tail = `${repeatText(st)}${inputsText(st, prevId)}`;
    if (col.round != null) {
      const round = S().rounds[col.round];
      return `<div class="stage-column" data-round-index="${col.round}" data-stand-key="${esc(key)}">
          ${head(`R${col.round + 1}`)}
          <div class="model-stack" id="${stack}">${round.models.map(modelBlock).join('')}</div>
          <div class="proto-stand-meta">${bang(key)}<span class="proto-stand-line"><b>${esc(st.id || '')}</b> ${esc(cut(st.title, 40))}${round.order === 'sequential' ? ' · по очереди' : ''}</span>${tail}</div>
          ${artifactsHtml(listOf(st.artifacts))}
        </div>`;
    }
    if (col.synth) {
      const options = S().models.map((n) => `<option value="${esc(n)}"${n === col.synth.model ? ' selected' : ''}>${esc(n)}</option>`).join('');
      return `<div class="stage-column${col.final ? ' synthesis-capable' : ''}"${col.final ? ' id="synthesisColumn" data-stage="synthesis"' : ''} data-stand-key="${esc(key)}">
          ${head(col.final ? 'Final' : 'Синтез')}
          <div class="model-stack" id="${stack}">
            <div class="model-block pipeline-synthesis-block selected-synthesizer proto-stand-card" data-stand-key="${esc(key)}">
              <div class="model-header"><span class="status-indicator" aria-hidden="true"></span><span class="model-name">Synthesis</span>${bang(key)}</div>
              <select class="synthesis-flow-select" data-stand-key="${esc(key)}" aria-label="Модель синтеза">${options}</select>
              ${own(st.role) ? `<div class="proto-stand-line">роль: ${esc(st.role)}</div>` : ''}
            </div>
          </div>
          <div class="proto-stand-meta"><span class="proto-stand-line"><b>${esc(st.id || '')}</b> ${esc(cut(st.title, 40))}</span>${tail}</div>
          ${artifactsHtml(listOf(st.artifacts))}
        </div>`;
    }
    const [label, icon] = KIND[st.block] || [String(st.block || '?'), 'ti-help'];
    const goes = st.block === 'route' ? listOf(st.choices).map((c) => `<div class="proto-stand-line">${esc(cut(c?.when, 30))} → ${esc(listOf(c?.goes).join(', '))}</div>`).join('') : '';
    const from = st.block === 'list' && own(st.from) && refId(st.from) !== prevId ? `<div class="proto-stand-line">из: ${esc(st.from)}</div>` : '';
    const over = st.block === 'foreach' && own(st.over) && refId(st.over) !== prevId ? `<div class="proto-stand-line">по: ${esc(st.over)}</div>` : '';
    return `<div class="stage-column" data-stand-key="${esc(key)}">
        ${head(esc(label), ' proto-stand-kind')}
        <div class="model-stack" id="${stack}">
          <div class="model-block inactive proto-stand-card" data-stand-key="${esc(key)}">
            <div class="model-header"><i class="ti ${icon} proto-stand-icon" aria-hidden="true"></i><span class="model-name" title="${esc(st.title)}">${esc(st.title || '—')}</span>${bang(key)}</div>
            <div class="proto-stand-line"><b>${esc(st.id || '')}</b> ${esc(cut(st.why, 70))}</div>
            ${repeatText(st)}${goes}${from}${over}
            ${st.block === 'foreach' ? nestedHtml(st.body) : ''}
          </div>
        </div>
        <div class="proto-stand-meta">${inputsText(st, prevId)}</div>
        ${artifactsHtml(listOf(st.artifacts))}
      </div>`;
  }

  // Линия к этапу активна, если он берёт вход у соседа слева (inputs/repeats/from/over); иначе — серая.
  const linksTo = (st, id) => !!id && [...listOf(st.inputs), st.from, st.over].some((r) => own(r) && refId(r) === id);

  function render() {
    const root = $('pipelineFlow');
    if (!root) return;
    const cols = stand.layout;
    let html = `<div class="stage-column entry-column">
        <div class="stage-label"><span class="entry-badge">In</span></div>
        <div class="entry-wrapper" id="entryWrapper"><div class="entry-point" id="entryPoint" title="Общие значения" style="cursor:pointer">▶</div></div>
      </div>
      <div class="connector-group"><svg class="connector-svg" id="svg-in-models"></svg></div>`;
    cols.forEach((col, k) => {
      if (k > 0) html += `<div class="connector-group"><svg class="connector-svg" id="stand-svg-${k}"></svg></div>`;
      html += columnHtml(col, k, k > 0 ? cols[k - 1].step.id : '');
    });
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
    panel.querySelectorAll('#pipelineFlow .connector-svg').forEach((svg) => { svg.style.height = `${max}px`; svg.setAttribute('height', `${max}`); });
    const entry = $('entryWrapper');
    if (entry) entry.style.height = `${max}px`;
    const mode = (col, side) => (col.round != null ? side : 'all');
    if (cols.length) canvas().drawInputSplitConnector?.('svg-in-models', 'stand-stack-0', 'active', mode(cols[0], 'input'));
    for (let k = 1; k < cols.length; k++) {
      const color = linksTo(cols[k].step, cols[k - 1].step.id) ? 'brain-flow' : 'inactive';
      canvas().drawMergeSplitConnector?.(`stand-svg-${k}`, `stand-stack-${k - 1}`, `stand-stack-${k}`, color, { sourceMode: mode(cols[k - 1], 'send'), targetMode: mode(cols[k], 'input') });
    }
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
        ...Object.keys(m).filter((x) => !['name', 'role', 'task'].includes(x)).map((x) => indent(`${LABELS[x] || x}:${['discipline', 'request'].includes(x) ? `\n${indent(fmt(x, m[x]))}` : ` ${fmt(x, m[x])}`}`))].join('\n') : String(m))).join('\n');
    }
    if (key === 'discipline') return fmtDiscipline(value);
    if (key === 'maxWords') return wordsOf(value) ? `${wordsOf(value)} слов` : String(value);
    if (key === 'modelNotes' && isObj(value)) return Object.entries(value).map(([n, v]) => `${n}: ${v}`).join('\n') || '—';
    if (key === 'run' && isObj(value)) {
      return Object.entries(value).map(([k, v]) => (k === 'policy' ? `запуск: ${v}${POLICY_TEXT[v] ? ` (${POLICY_TEXT[v]})` : ''}` : k === 'maxWords' ? `общий предел: ${fmt('maxWords', v)}` : `${k}: ${fmt(k, v)}`)).join('\n');
    }
    if (key === 'defaults' && isObj(value)) {
      const names = { roundTask: 'задание раундов', synthesisTask: 'задание синтеза', discipline: 'дисциплина', modelNotes: 'особенности моделей' };
      return Object.entries(value).map(([k, v]) => (isObj(v) ? `${names[k] || k}:\n${indent(fmt(k, v))}` : `${names[k] || k}: ${fmt(k, v)}`)).join('\n');
    }
    if (key === 'choices' && Array.isArray(value)) return value.map((c) => `когда ${c?.when || '?'} → ${listOf(c?.goes).join(', ') || '—'}`).join('\n');
    if (key === 'body' && Array.isArray(value)) return value.map((s) => `${s?.id || '?'} · ${s?.block || '?'} — ${s?.title || ''}`).join('\n');
    if (key === 'order') return `${value}${ORDER_TEXT[value] ? ` (${ORDER_TEXT[value]})` : ''}`;
    if (Array.isArray(value)) return value.map((v) => (v && typeof v === 'object' ? fmt('', v) : String(v))).join(', ');
    if (typeof value === 'object') return Object.entries(value).map(([k, v]) => `${k}: ${typeof v === 'object' ? fmt(k, v) : v}`).join(', ');
    return String(value);
  };
  // isRoot — раздел окна ▶: поля верхнего уровня схемы (task, defaults, run) и общие замечания.
  function schemaSection(st, isRoot) {
    const keys = isRoot ? ['task', 'defaults', 'run'] : [...COMMON.filter((k) => k in st || ['block', 'title', 'why', 'inputs', 'artifacts'].includes(k)),
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
  }
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
  function openInfo(st) {
    stand.current = null;
    const modal = infoModal();
    const [label, icon] = KIND[st.block] || [String(st.block || '?'), 'ti-help'];
    modal.querySelector('.modal-content').innerHTML = `
      <header class="custom-card-top custom-defaults-top">
        <h3 class="custom-card-model"><i class="ti ${icon}" aria-hidden="true"></i>${esc(st.title || st.id || '—')}<span class="custom-card-where">${esc(label)} · ${esc(st.id || '')}</span></h3>
        <button type="button" class="modal-button" data-stand-close>Закрыть</button>
      </header>
      <div class="custom-card-body">${schemaSection(st)}</div>`;
    show(modal);
  }
  const show = (modal) => { modal.style.display = 'flex'; modal.classList.add('is-visible'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open'); };
  const hide = (modal) => { modal.style.display = 'none'; modal.classList.remove('is-visible'); modal.setAttribute('aria-hidden', 'true'); if (!anyOpen()) document.body.classList.remove('modal-open'); };
  const anyOpen = () => ['pipeline-block-info-modal', 'proto-stand-info', 'proto-stand-modal'].some((id) => $(id)?.classList.contains('is-visible')) || !!$('pipeline-stage-dialog')?.open;

  const colOf = (key) => stand.layout.find((c) => c.key === key);
  const stepOf = (key) => stand.flat.find((e) => e.key === key)?.raw;
  function openSynth(col) {
    stand.current = { step: col.step, where: 'card' };
    const state = S();
    if (col.final) { state.final = col.synth; cards().openSynthesis?.('final'); return; }
    if (col.after >= 0 && col.after < state.rounds.length - 1) {
      state.rounds[col.after].intermediateSynthesis = col.synth;
      cards().openSynthesis?.('intermediate', col.after);
      return;
    }
    // Синтез без раунда перед ним (или после последнего раунда): открывается через слот финального синтеза.
    const keep = state.final;
    state.final = Object.assign(col.synth, { on: true });
    cards().openSynthesis?.('final');
    if (keep !== col.synth) state.final = keep;
  }

  const CONTROLS = 'input, select, button, option, summary';
  function bindFlow() {
    const flow = $('pipelineFlow');
    flow.addEventListener('click', (event) => {
      if (!stand.active) return;
      const t = event.target;
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
      const sub = t.closest('.proto-stand-sub');
      if (sub) { const st = stepOf(sub.dataset.standKey); if (st) openInfo(st); return; }
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
      if (col.synth) { openSynth(col); return; }
      openInfo(col.step);
    }, true);
    flow.addEventListener('change', (event) => {
      if (!stand.active) return;
      const select = event.target.closest('.synthesis-flow-select[data-stand-key]');
      if (!select) return;
      event.stopPropagation();
      const col = colOf(select.dataset.standKey);
      if (col?.synth) col.synth.model = select.value;
      render();
    }, true);
    // «Новый pipeline» и импорт состояния — только на исходном холсте.
    ['pipeline-add-btn', 'pipeline-import-btn'].forEach((id) => $(id)?.addEventListener('click', () => { if (stand.active) reset(); }, true));
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
        <div class="custom-card-note"><button type="button" id="proto-stand-example-foreach">Пример с foreach</button> <button type="button" id="proto-stand-example-defaults">Пример с defaults</button></div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    const area = modal.querySelector('#proto-stand-json');
    modal.addEventListener('click', (event) => { if (event.target === modal) hide(modal); });
    modal.querySelector('#proto-stand-close').addEventListener('click', () => hide(modal));
    modal.querySelector('#proto-stand-example').addEventListener('click', () => { area.value = JSON.stringify(EXAMPLES.basic, null, 2); area.focus(); });
    modal.querySelector('#proto-stand-example-foreach').addEventListener('click', () => { area.value = JSON.stringify(EXAMPLES.foreach, null, 2); area.focus(); });
    modal.querySelector('#proto-stand-example-defaults').addEventListener('click', () => { area.value = JSON.stringify(EXAMPLES.defaults, null, 2); area.focus(); });
    modal.querySelector('#proto-stand-clear').addEventListener('click', () => { area.value = ''; stand.text = ''; stand.comment = ''; drawIssues('Поле очищено.', []); area.focus(); });
    modal.querySelector('#proto-stand-reset').addEventListener('click', () => { area.value = ''; stand.text = ''; reset(); });
    modal.querySelector('#proto-stand-apply').addEventListener('click', () => {
      stand.text = area.value;
      const { schema, flat, issues, comment } = validate(area.value);
      stand.comment = comment;
      if (schema) applySchema(schema, flat, issues);
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

  document.title = `${document.title} · v${STAND_VERSION}`;

  // ---------- Стили стенда (только то, чего нет в настоящих стилях) ----------
  const style = document.createElement('style');
  style.textContent = `
    .model-block.proto-stand-card { height: auto; min-height: var(--pipeline-block-height); justify-content: flex-start; gap: 3px; cursor: pointer; }
    .proto-stand-icon { font-size: 14px; color: var(--pipeline-muted); flex: 0 0 auto; }
    .proto-stand-line { display: block; font-size: 10px; line-height: 1.35; color: var(--pipeline-muted); overflow-wrap: anywhere; }
    .proto-stand-repeat { color: #b45309; }
    .proto-stand-meta { width: 139px; margin-top: 6px; }
    .proto-stand-kind { background: #f1f5f9; color: #64748b; text-transform: uppercase; }
    .proto-stand-bang { flex: 0 0 auto; display: inline-grid; place-items: center; width: 14px; height: 14px; border-radius: 50%; background: #dc2626; color: #fff; font-size: 10px; font-weight: 700; cursor: help; }
    .proto-stand-bang.is-warn { background: #f59e0b; }
    .proto-stand-meta > .proto-stand-bang { float: right; }
    .proto-stand-body { font-size: 10px; color: var(--pipeline-text); }
    .proto-stand-body summary { cursor: pointer; color: var(--pipeline-muted); }
    .proto-stand-sub { display: flex; gap: 4px; align-items: center; padding: 2px 0; border-top: 1px dashed #e2e8f0; cursor: pointer; overflow-wrap: anywhere; }
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
    #proto-stand-info .modal-content { height: auto; max-height: calc(100dvh - 32px); }
    .proto-stand-rows { display: grid; grid-template-columns: max-content 1fr; gap: 4px 14px; margin-top: 6px; }
    .proto-stand-row { display: contents; }
    .proto-stand-row > span { color: var(--pipeline-muted); white-space: nowrap; }
    .proto-stand-row > div { color: var(--pipeline-text); white-space: pre-wrap; overflow-wrap: anywhere; }
  `;
  document.head.appendChild(style);

  // ---------- Примеры ----------
  const EXAMPLES = {
    basic: {
      task: 'Подготовить план запуска нового тарифа для малого бизнеса',
      steps: [
        { id: 's1', block: 'source', kind: 'text', title: 'Описание тарифа', artifacts: ['Бриф'], why: 'Даёт всем моделям одинаковые исходные данные о тарифе.' },
        { id: 's2', block: 'round', title: 'Первые планы', order: 'parallel', task: 'Предложи план запуска тарифа по брифу.', inputs: ['s1.Бриф'], artifacts: ['Черновики'],
          models: [{ name: 'Claude', role: 'автор', task: 'Сделай упор на сроки и этапы.' }, { name: 'GPT', role: 'критик', task: 'Ищи риски и слабые места.' }, { name: 'Gemini', role: 'аналитик', task: 'Оцени рынок и цены.' }],
          why: 'Три независимых взгляда на одну задачу.' },
        { id: 's3', block: 'synthesis', title: 'Сводный план', model: 'Claude', role: 'свести', task: 'Сведи черновики в один план.', inputs: ['s2.Черновики'], artifacts: ['План'], why: 'Нужен один план вместо трёх.' },
        { id: 's4', block: 'gate', title: 'Проверка плана', criteria: 'Есть сроки, бюджет и ответственные; нет противоречий.', inputs: ['s3.План'], artifacts: ['Вердикт'], why: 'Не отдавать план без сроков и бюджета.' },
        { id: 's5', block: 'round', title: 'Доработка', repeats: 's2', because: 'проверка s4 не пройдена', order: 'sequential', task: 'Исправь план по замечаниям проверки.', inputs: ['s3.План', 's4.Вердикт'], artifacts: ['Правки'],
          models: [{ name: 'Claude', role: 'автор' }, { name: 'GPT', role: 'критик' }, { name: 'Gemini', role: 'аналитик' }], why: 'Закрыть замечания проверки.' },
        { id: 's6', block: 'synthesis', title: 'Итоговый план', repeats: 's3', because: 'после доработки', model: 'GPT', role: 'судья', task: 'Собери итоговый план с учётом правок.', inputs: ['s5.Правки', 's3.План'], artifacts: ['Итог'], why: 'Окончательная версия плана.' },
        { id: 's7', block: 'file', title: 'Сохранить план', file: 'plan.md', mode: 'overwrite', inputs: ['s6.Итог'], why: 'Результат нужен файлом.' }
      ]
    },
    foreach: {
      task: 'Оценить каждую идею из списка и собрать рейтинг',
      steps: [
        { id: 's1', block: 'source', kind: 'document', title: 'Список идей', artifacts: ['Идеи'], why: 'Исходный материал — документ с идеями.' },
        { id: 's2', block: 'list', title: 'Разбить на пункты', from: 's1.Идеи', rule: 'одна идея — один пункт', artifacts: ['Пункты'], why: 'Каждую идею разбираем отдельно.' },
        { id: 's3', block: 'foreach', title: 'Разбор каждой идеи', over: 's2.Пункты', artifacts: ['Разборы'], why: 'Одинаковый разбор для всех пунктов.',
          body: [
            { id: 's3a', block: 'round', title: 'Разбор идеи', models: [{ name: 'Claude', role: 'аналитик' }, { name: 'GPT', role: 'критик' }], task: 'Разбери идею: плюсы, минусы, риски.', inputs: ['s3'], artifacts: ['Мнения'], why: 'Два взгляда на идею.' },
            { id: 's3b', block: 'synthesis', title: 'Вывод по идее', model: 'Gemini', role: 'сгруппировать', inputs: ['s3a.Мнения'], artifacts: ['Вывод'], why: 'Один вывод на идею.' }
          ] },
        { id: 's4', block: 'assemble', title: 'Собрать отчёт', inputs: ['s3.Разборы'], template: '# Идеи\n{для каждой: название, вывод}', artifacts: ['Отчёт'], why: 'Все разборы в одном документе.' },
        { id: 's5', block: 'score', title: 'Рейтинг', inputs: ['s4.Отчёт'], criteria: ['польза', 'стоимость', 'риск'], weights: { польза: 0.5, стоимость: 0.3, риск: 0.2 }, artifacts: ['Рейтинг'], why: 'Порядок, в котором браться за идеи.' }
      ]
    },
    defaults: {
      task: 'Выбрать технологический стек для внутреннего сервиса заявок',
      defaults: {
        roundTask: 'Учти ответы предыдущего раунда и улучши своё предложение.',
        synthesisTask: 'Сведи предложения в одно решение с обоснованием.',
        discipline: { content: 'Пиши по делу: варианты, плюсы, минусы, риски.', lines: ['Не повторяй чужие аргументы дословно.'] },
        modelNotes: { Claude: 'Отвечай структурно, с короткими заголовками.', GPT: 'Называй конкретные библиотеки и версии.' }
      },
      run: { policy: 'manual', maxWords: 500 },
      steps: [
        { id: 's1', block: 'source', kind: 'text', title: 'Требования к сервису', artifacts: ['Требования'], why: 'Всем моделям — одинаковые требования.' },
        { id: 's2', block: 'round', title: 'Первые предложения', order: 'parallel', task: 'Предложи стек для сервиса по требованиям.', inputs: ['s1.Требования'], artifacts: ['Предложения'],
          models: [
            { name: 'Claude', role: 'архитектор', maxWords: 700, discipline: { lines: ['Начни со схемы архитектуры в 3–5 пунктах.'] } },
            { name: 'GPT', role: 'критик', task: 'Ищи слабые места каждого варианта.' },
            { name: 'Gemini', role: 'аналитик', maxWords: 300 }
          ],
          why: 'Три независимых предложения.' },
        { id: 's3', block: 'round', title: 'Критика', order: 'sequential', inputs: ['s2.Предложения'], artifacts: ['Замечания'],
          models: [
            { name: 'GPT', role: 'критик', request: 'Задача:\n{задача}\n\nПредложения коллег:\n{вход}\n\nНайди в каждом предложении три главных риска и предложи, как их снизить.', discipline: { lines: ['Риски нумеруй: 1, 2, 3.'] } },
            { name: 'Claude', role: 'архитектор', discipline: { limit: '[RESPONSE_LIMIT] Не больше {слов} слов.' } }
          ],
          why: 'Найти риски до выбора.' },
        { id: 's4', block: 'round', title: 'Доработка', task: 'Исправь своё предложение по замечаниям.', inputs: ['s2.Предложения', 's3.Замечания'], artifacts: ['Доработки'],
          models: [{ name: 'Claude', role: 'архитектор' }, { name: 'GPT', role: 'критик' }, { name: 'Gemini', role: 'аналитик', maxWords: 500 }],
          why: 'Учесть критику.' },
        { id: 's5', block: 'synthesis', title: 'Итоговое решение', model: 'Claude', role: 'свести', maxWords: 1000,
          discipline: { lines: ['В конце — таблица: компонент, выбор, причина.'] }, inputs: ['s4.Доработки'], artifacts: ['Решение'], why: 'Одно решение вместо трёх.' }
      ]
    }
  };

  root.ProtoStand = {
    get active() { return stand.active; },
    version: STAND_VERSION, render, draw, validate, reset, open: openStand, examples: EXAMPLES
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindFlow);
  else bindFlow();
})(window);
